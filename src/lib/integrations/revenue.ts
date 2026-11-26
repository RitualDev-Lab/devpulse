/**
 * Developer Revenue Integration for DevPulse
 * Aggregates revenue, MRR, and transaction velocity across Stripe, Dodo Payments, and GitHub Sponsors.
 */

import { validatePublicUrl } from "@/lib/security/ssrf";
import { isSettledPayment, minorToMajor, withinTrailingDays } from "@/lib/revenue/transaction-rules";
import { summarizeRevenueAtRisk } from "@/lib/revenue/revenue-risk";
import { currencyMinorUnitDigits } from "@/lib/revenue/transaction-rules";

export interface TransactionItem {
  id: string;
  customer: string;
  amount: number;
  currency: string;
  provider: string;
  status: string;
  date: string;
}

export interface ProviderBreakdownItem {
  provider: string;
  label: string;
  mrr: number;
  totalRevenue: number;
  payingCustomers: number;
  activeSubscriptions: number;
  currency: string;
}

export interface RevenueStats {
  mrr: number;
  totalRevenue: number;
  netVolume30Days: number;
  payingCustomers: number;
  activeSubscriptions: number;
  currency: string;
  provider: "stripe" | "dodo" | "hybrid" | "demo";
  isDemo: boolean;
  history: Array<{ date: string; amount: number }>;
  recentTransactions: TransactionItem[];
  revenueAtRisk?: Array<{
    currency: string;
    transactionCount: number;
    settledAmountMinor: number;
    pendingAmountMinor: number;
    failedAmountMinor: number;
    refundedAmountMinor: number;
    chargebackAmountMinor: number;
    exposedAmountMinor: number;
    riskScorePercent: number;
    providers: string[];
    sampleLimited: boolean;
  }>;
  providerBreakdown?: ProviderBreakdownItem[];
}

export interface ModularPaymentConnectorInput {
  id: string;
  provider: string;
  label: string;
  targetUrl?: string | null;
  apiKey?: string | null;
}

/**
 * Fetch Stripe Metrics using Restricted API Key (Read-only)
 */
async function fetchStripeRevenue(apiKey: string): Promise<RevenueStats | null> {
  try {
    const authHeader = { Authorization: `Bearer ${apiKey}` };

    // Fetch active subscriptions for MRR
    const subsRes = await fetch("https://api.stripe.com/v1/subscriptions?status=active&limit=100", {
      headers: authHeader,
    });
    const subsData = subsRes.ok ? await subsRes.json() : null;

    let mrr = 0;
    let activeSubs = 0;
    const subscriptionCurrencies = new Set<string>();
    if (subsData && Array.isArray(subsData.data)) {
      activeSubs = subsData.data.length;
      for (const sub of subsData.data) {
        for (const item of sub.items?.data || []) {
          const currency = String(item.price?.currency || "USD").toUpperCase();
          subscriptionCurrencies.add(currency);
          const unitAmount = minorToMajor(Number(item.price?.unit_amount || 0), currency);
          const interval = item.price?.recurring?.interval;
          if (interval === "month") mrr += unitAmount;
          else if (interval === "year") mrr += unitAmount / 12;
        }
      }
    }

    // Fetch recent charges for 30-day velocity
    const chargesRes = await fetch("https://api.stripe.com/v1/charges?limit=25", {
      headers: authHeader,
    });
    const chargesData = chargesRes.ok ? await chargesRes.json() : null;

    let netVolume30Days = 0;
    const chargeCurrencies = new Set<string>();
    const recentTransactions: TransactionItem[] = [];
    const dateMap: Record<string, number> = {};

    if (chargesData && Array.isArray(chargesData.data)) {
      for (const ch of chargesData.data) {
        const currency = String(ch.currency || "USD").toUpperCase();
        chargeCurrencies.add(currency);
        const amt = minorToMajor(Number(ch.amount || 0), currency);
        const createdAtMs = Number(ch.created || 0) * 1000;
        const dStr = new Date(createdAtMs || Date.now()).toISOString().split("T")[0];
        const settled = ch.paid === true && ch.status !== "failed" && !ch.refunded;
        if (settled && withinTrailingDays(createdAtMs)) {
          netVolume30Days += amt;
          dateMap[dStr] = (dateMap[dStr] || 0) + amt;
        }

        recentTransactions.push({
          id: ch.id,
          customer: ch.billing_details?.name || ch.billing_details?.email || "Customer",
          amount: amt,
          currency,
          provider: "stripe",
          status: settled ? "succeeded" : ch.refunded ? "refunded" : ch.status === "failed" ? "failed" : "pending",
          date: dStr,
        });
      }
    }

    // Build 30-day history array
    const history = Object.entries(dateMap)
      .map(([date, amount]) => ({ date, amount }))
      .sort((a, b) => a.date.localeCompare(b.date));
    const currencyCount = new Set([...chargeCurrencies, ...subscriptionCurrencies]).size;
    const hasSingleCurrency = currencyCount <= 1;

    return {
      mrr: hasSingleCurrency ? Math.round(mrr) : 0,
      totalRevenue: hasSingleCurrency ? Math.round(netVolume30Days * 1.5) : 0, // estimated total
      netVolume30Days: hasSingleCurrency ? Math.round(netVolume30Days) : 0,
      payingCustomers: activeSubs,
      activeSubscriptions: activeSubs,
      currency: currencyCount > 1 ? "MULTI" : Array.from(chargeCurrencies)[0] || Array.from(subscriptionCurrencies)[0] || "USD",
      provider: "stripe",
      isDemo: false,
      history: hasSingleCurrency && history.length > 0 ? history : [{ date: new Date().toISOString().split("T")[0], amount: 0 }],
      recentTransactions: recentTransactions.slice(0, 50),
    };
  } catch (err) {
    console.error("Error fetching Stripe revenue:", err);
    return null;
  }
}

/**
 * Fetch Dodo Payments Metrics (Developer-first Checkout & Merchant of Record)
 */
async function fetchDodoRevenue(apiKey: string, environment: string = "live"): Promise<RevenueStats | null> {
  try {
    const baseUrl = environment === "test" ? "https://test.dodopayments.com" : "https://live.dodopayments.com";
    const authHeader = { Authorization: `Bearer ${apiKey.trim()}` };

    const [paymentsRes, subsRes, custRes] = await Promise.all([
      fetch(`${baseUrl}/payments?page_size=50`, {
        headers: authHeader,
        next: { revalidate: 300 },
      }).catch(() => null),
      fetch(`${baseUrl}/subscriptions?page_size=50`, {
        headers: authHeader,
        next: { revalidate: 300 },
      }).catch(() => null),
      fetch(`${baseUrl}/customers?page_size=50`, {
        headers: authHeader,
        next: { revalidate: 300 },
      }).catch(() => null),
    ]);

    const paymentsData = paymentsRes && paymentsRes.ok ? await paymentsRes.json() : null;
    const subsData = subsRes && subsRes.ok ? await subsRes.json() : null;
    const custData = custRes && custRes.ok ? await custRes.json() : null;

    let netVolume = 0;
    const transactions: TransactionItem[] = [];
    const dateMap: Record<string, number> = {};
    let detectedCurrency = "USD";
    const subscriptionCurrencies = new Set<string>();
    const paymentCurrencies = Array.isArray(paymentsData?.items)
      ? Array.from(new Set(paymentsData.items.map((payment: { currency?: string }) => String(payment.currency || "USD").toUpperCase())))
      : [];

    if (paymentsData && Array.isArray(paymentsData.items)) {
      for (const p of paymentsData.items) {
        const curr = (p.currency || "USD").toUpperCase();
        const amt = minorToMajor(Number(p.total_amount || 0), curr);
        detectedCurrency = curr;
        const dStr = p.created_at ? p.created_at.split("T")[0] : new Date().toISOString().split("T")[0];
        const settled = isSettledPayment(p.status);
        if (settled && withinTrailingDays(p.created_at)) {
          netVolume += amt;
          dateMap[dStr] = (dateMap[dStr] || 0) + amt;
        }

        transactions.push({
          id: p.payment_id || `dodo_${Math.random().toString(36).substring(7)}`,
          customer: p.customer?.name || p.customer?.email || "Customer",
          amount: amt,
          currency: curr,
          provider: "dodo",
          status: settled ? "succeeded" : String(p.status || "pending"),
          date: dStr,
        });
      }
    }

    // Active subscriptions & MRR
    let mrr = 0;
    let activeSubs = 0;
    if (subsData && Array.isArray(subsData.items)) {
      for (const sub of subsData.items) {
        if (sub.status === "active") {
          activeSubs++;
          const currency = String(sub.currency || "USD").toUpperCase();
          subscriptionCurrencies.add(currency);
          if (paymentCurrencies.length === 0 || paymentCurrencies.includes(currency)) {
            const recurringAmt = minorToMajor(Number(sub.total_amount || sub.amount || 0), currency);
            mrr += recurringAmt;
          }
        }
      }
    }

    // Paying customers
    let payingCustomers = 0;
    if (custData && Array.isArray(custData.items) && custData.items.length > 0) {
      payingCustomers = custData.items.length;
    } else {
      payingCustomers = new Set(transactions.map((t) => t.customer)).size;
    }

    const history = Object.entries(dateMap)
      .map(([date, amount]) => ({ date, amount }))
      .sort((a, b) => a.date.localeCompare(b.date));
    const currencyCount = new Set([...paymentCurrencies, ...subscriptionCurrencies]).size;
    const hasSingleCurrency = currencyCount <= 1;

    return {
      mrr: hasSingleCurrency ? Math.round(mrr) : 0,
      totalRevenue: hasSingleCurrency ? Math.round(netVolume) : 0,
      netVolume30Days: hasSingleCurrency ? Math.round(netVolume) : 0,
      payingCustomers,
      activeSubscriptions: activeSubs,
      currency: currencyCount > 1 ? "MULTI" : detectedCurrency,
      provider: "dodo",
      isDemo: false,
      history: hasSingleCurrency && history.length > 0 ? history : [{ date: new Date().toISOString().split("T")[0], amount: 0 }],
      recentTransactions: transactions.slice(0, 50),
    };
  } catch (err) {
    console.error("Error fetching Dodo Payments revenue:", err);
    return null;
  }
}

async function fetchModularConnectorRevenue(
  conn: ModularPaymentConnectorInput
): Promise<RevenueStats | null> {
  const apiKey = conn.apiKey?.trim() || "";
  const provider = conn.provider.toLowerCase();
  const today = new Date().toISOString().split("T")[0];

  try {
    if (provider === "stripe" && apiKey) {
      return await fetchStripeRevenue(apiKey);
    }
    if (provider === "dodo" && apiKey) {
      return await fetchDodoRevenue(apiKey, "live");
    }
    if (provider === "lemonsqueezy" && apiKey) {
      const [storesRes, ordersRes] = await Promise.all([
        fetch("https://api.lemonsqueezy.com/v1/stores", {
          headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/vnd.api+json" },
          next: { revalidate: 300 },
        }).catch(() => null),
        fetch("https://api.lemonsqueezy.com/v1/orders?page[size]=25", {
          headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/vnd.api+json" },
          next: { revalidate: 300 },
        }).catch(() => null),
      ]);
      const stores = storesRes?.ok ? await storesRes.json() : null;
      const orders = ordersRes?.ok ? await ordersRes.json() : null;
      const attr = stores?.data?.[0]?.attributes;
      const totalCents = attr?.total_revenue || 0;
      const txList: TransactionItem[] = [];
      const currencies = new Set<string>();
      const dateMap: Record<string, number> = {};
      let net30 = 0;
      if (Array.isArray(orders?.data)) {
        for (const o of orders.data) {
          const a = o.attributes || {};
          const currency = String(a.currency || "USD").toUpperCase();
          currencies.add(currency);
          const amt = minorToMajor(Number(a.total || 0), currency);
          const dStr = a.created_at ? String(a.created_at).slice(0, 10) : today;
          const settled = a.status === "paid" && !a.refunded;
          if (settled && withinTrailingDays(a.created_at)) {
            net30 += amt;
            dateMap[dStr] = (dateMap[dStr] || 0) + amt;
          }
          txList.push({
            id: String(o.id),
            customer: a.user_name || a.user_email || "Lemon Squeezy Buyer",
            amount: amt,
            currency: (a.currency || "USD").toUpperCase(),
            provider: "lemonsqueezy",
            status: settled ? "succeeded" : String(a.status || "pending"),
            date: dStr,
          });
        }
      }
      const hasSingleCurrency = currencies.size <= 1;
      return {
        mrr: hasSingleCurrency ? Math.round(net30) : 0,
        totalRevenue: hasSingleCurrency ? Math.round(totalCents / 100) || Math.round(net30) : 0,
        netVolume30Days: hasSingleCurrency ? Math.round(net30) : 0,
        payingCustomers: attr?.total_sales || txList.length,
        activeSubscriptions: attr?.total_sales || txList.length,
        currency: currencies.size > 1 ? "MULTI" : (attr?.currency || txList[0]?.currency || "USD").toUpperCase(),
        provider: "hybrid",
        isDemo: false,
        history: hasSingleCurrency ? Object.entries(dateMap).map(([date, amount]) => ({ date, amount })).sort((a, b) => a.date.localeCompare(b.date)) : [{ date: today, amount: 0 }],
        recentTransactions: txList.slice(0, 50),
      };
    }
    if (provider === "polar" && apiKey) {
      const res = await fetch("https://api.polar.sh/v1/orders/?limit=30", {
        headers: { Authorization: `Bearer ${apiKey}` },
        next: { revalidate: 300 },
      }).catch(() => null);
      if (!res?.ok) return null;
      const json = await res.json();
      const items = Array.isArray(json.items) ? json.items : [];
      const dateMap: Record<string, number> = {};
      let total = 0;
      const txList: TransactionItem[] = [];
      const currencies: string[] = Array.from(new Set<string>(items.map((order: { currency?: string }) => String(order.currency || "USD").toUpperCase())));
      for (const o of items) {
        const currency = String(o.currency || "USD").toUpperCase();
        const amt = minorToMajor(Number(o.amount || 0), currency);
        const dStr = o.created_at ? String(o.created_at).slice(0, 10) : today;
        const settled = isSettledPayment(o.status);
        if (settled && withinTrailingDays(o.created_at)) {
          total += amt;
          dateMap[dStr] = (dateMap[dStr] || 0) + amt;
        }
        txList.push({
          id: String(o.id),
          customer: o.customer?.email || "Polar Backer",
          amount: amt,
          currency,
          provider: "polar",
          status: settled ? "succeeded" : String(o.status || "pending"),
          date: dStr,
        });
      }
      const hasSingleCurrency = currencies.length <= 1;
      return {
        mrr: hasSingleCurrency ? Math.round(total) : 0,
        totalRevenue: hasSingleCurrency ? Math.round(total) : 0,
        netVolume30Days: hasSingleCurrency ? Math.round(total) : 0,
        payingCustomers: items.length,
        activeSubscriptions: items.length,
        currency: currencies.length > 1 ? "MULTI" : currencies[0] || "USD",
        provider: "hybrid",
        isDemo: false,
        history: hasSingleCurrency ? Object.entries(dateMap).map(([date, amount]) => ({ date, amount })).sort((a, b) => a.date.localeCompare(b.date)) : [{ date: today, amount: 0 }],
        recentTransactions: txList.slice(0, 50),
      };
    }
    if (provider === "gumroad" && apiKey) {
      const res = await fetch("https://api.gumroad.com/v2/sales", {
        headers: { Authorization: `Bearer ${apiKey}` },
        next: { revalidate: 300 },
      }).catch(() => null);
      if (!res?.ok) return null;
      const json = await res.json();
      const sales = Array.isArray(json.sales) ? json.sales : [];
      const dateMap: Record<string, number> = {};
      let total = 0;
      const txList: TransactionItem[] = [];
      const currencies = new Set<string>();
      for (const s of sales) {
        // Gumroad's canonical `price` is USD cents. Use buyer-presentment only when
        // supplied, since that explicitly gives both the charged currency and its minor units.
        const presentment = s.buyer_presentment && typeof s.buyer_presentment === "object" ? s.buyer_presentment : null;
        const currency = String(presentment?.currency || "USD").toUpperCase();
        currencies.add(currency);
        const grossMinor = Number(presentment?.total_cents ?? s.price ?? 0);
        const refundMinor = Math.min(grossMinor, Math.max(0, Number(presentment?.refunded_cents ?? s.refunded_cents ?? 0) || 0));
        const gross = minorToMajor(grossMinor, currency);
        const net = Math.max(0, minorToMajor(grossMinor - refundMinor, currency));
        const dStr = s.created_at ? String(s.created_at).slice(0, 10) : today;
        const isRefunded = s.refunded === true || (grossMinor > 0 && refundMinor >= grossMinor);
        const isPartiallyRefunded = !isRefunded && (s.partially_refunded === true || refundMinor > 0);
        const isDisputed = s.chargedback === true || s.chargebacked === true || s.disputed === true;
        const settled = s.paid === true && !isRefunded && !isDisputed;
        if (settled && withinTrailingDays(s.created_at)) {
          total += net;
          dateMap[dStr] = (dateMap[dStr] || 0) + net;
        }
        txList.push({
          id: String(s.id),
          customer: s.email || s.full_name || "Gumroad Customer",
          amount: isPartiallyRefunded ? net : gross,
          currency,
          provider: "gumroad",
          status: isRefunded ? "refunded" : isDisputed ? "chargebacked" : isPartiallyRefunded ? "partially_refunded" : s.paid === true ? "succeeded" : "pending",
          date: dStr,
        });
      }
      const hasSingleCurrency = currencies.size <= 1;
      return {
        mrr: hasSingleCurrency ? Math.round(total) : 0,
        totalRevenue: hasSingleCurrency ? Math.round(total) : 0,
        netVolume30Days: hasSingleCurrency ? Math.round(total) : 0,
        payingCustomers: sales.length,
        activeSubscriptions: sales.length,
        currency: currencies.size > 1 ? "MULTI" : Array.from(currencies)[0] || "USD",
        provider: "hybrid",
        isDemo: false,
        history: hasSingleCurrency ? Object.entries(dateMap).map(([date, amount]) => ({ date, amount })).sort((a, b) => a.date.localeCompare(b.date)) : [{ date: today, amount: 0 }],
        recentTransactions: txList.slice(0, 50),
      };
    }
    if (provider === "paddle" && apiKey) {
      const res = await fetch("https://api.paddle.com/transactions?per_page=25", {
        headers: { Authorization: `Bearer ${apiKey}` },
        next: { revalidate: 300 },
      }).catch(() => null);
      if (!res?.ok) return null;
      const json = await res.json();
      const rows = Array.isArray(json.data) ? json.data : [];
      const dateMap: Record<string, number> = {};
      let total = 0;
      const txList: TransactionItem[] = [];
      const currencies: string[] = Array.from(new Set<string>(rows.map((row: { currency_code?: string }) => String(row.currency_code || "USD").toUpperCase())));
      for (const r of rows) {
        const currency = String(r.currency_code || "USD").toUpperCase();
        const amt = minorToMajor(Number(r.details?.totals?.total || 0), currency);
        const dStr = r.created_at ? String(r.created_at).slice(0, 10) : today;
        const settled = isSettledPayment(r.status);
        if (settled && withinTrailingDays(r.created_at)) {
          total += amt;
          dateMap[dStr] = (dateMap[dStr] || 0) + amt;
        }
        txList.push({
          id: String(r.id),
          customer: r.customer_id || "Paddle Customer",
          amount: amt,
          currency,
          provider: "paddle",
          status: settled ? "succeeded" : String(r.status || "pending"),
          date: dStr,
        });
      }
      const hasSingleCurrency = currencies.length <= 1;
      return {
        mrr: hasSingleCurrency ? Math.round(total) : 0,
        totalRevenue: hasSingleCurrency ? Math.round(total) : 0,
        netVolume30Days: hasSingleCurrency ? Math.round(total) : 0,
        payingCustomers: rows.length,
        activeSubscriptions: rows.length,
        currency: currencies.length > 1 ? "MULTI" : currencies[0] || "USD",
        provider: "hybrid",
        isDemo: false,
        history: hasSingleCurrency ? Object.entries(dateMap).map(([date, amount]) => ({ date, amount })).sort((a, b) => a.date.localeCompare(b.date)) : [{ date: today, amount: 0 }],
        recentTransactions: txList.slice(0, 50),
      };
    }
    if (provider === "razorpay" && apiKey) {
      const authHeader = apiKey.includes(":")
        ? `Basic ${Buffer.from(apiKey).toString("base64")}`
        : `Bearer ${apiKey}`;
      const res = await fetch("https://api.razorpay.com/v1/payments?count=25", {
        headers: { Authorization: authHeader },
        next: { revalidate: 300 },
      }).catch(() => null);
      if (!res?.ok) return null;
      const json = await res.json();
      const items = Array.isArray(json.items) ? json.items : [];
      const dateMap: Record<string, number> = {};
      let total = 0;
      const txList: TransactionItem[] = [];
      const currencies: string[] = Array.from(new Set<string>(items.map((payment: { currency?: string }) => String(payment.currency || "INR").toUpperCase())));
      for (const p of items) {
        const currency = String(p.currency || "INR").toUpperCase();
        const amt = minorToMajor(Number(p.amount || 0), currency);
        const dStr = p.created_at ? new Date(p.created_at * 1000).toISOString().slice(0, 10) : today;
        const settled = p.status === "captured" && !p.refund_status;
        if (settled && withinTrailingDays(Number(p.created_at || 0))) {
          total += amt;
          dateMap[dStr] = (dateMap[dStr] || 0) + amt;
        }
        txList.push({
          id: String(p.id),
          customer: p.email || p.contact || "Razorpay Customer",
          amount: amt,
          currency,
          provider: "razorpay",
          status: settled ? "succeeded" : p.refund_status ? "refunded" : String(p.status || "pending"),
          date: dStr,
        });
      }
      const hasSingleCurrency = currencies.length <= 1;
      return {
        mrr: hasSingleCurrency ? Math.round(total) : 0,
        totalRevenue: hasSingleCurrency ? Math.round(total) : 0,
        netVolume30Days: hasSingleCurrency ? Math.round(total) : 0,
        payingCustomers: items.length,
        activeSubscriptions: items.length,
        currency: currencies.length > 1 ? "MULTI" : currencies[0] || "INR",
        provider: "hybrid",
        isDemo: false,
        history: hasSingleCurrency ? Object.entries(dateMap).map(([date, amount]) => ({ date, amount })).sort((a, b) => a.date.localeCompare(b.date)) : [{ date: today, amount: 0 }],
        recentTransactions: txList.slice(0, 50),
      };
    }
    if (provider === "custom" && conn.targetUrl) {
      const urlCheck = validatePublicUrl(conn.targetUrl, { allowHttp: false });
      if (!urlCheck.valid || !urlCheck.normalized) return null;
      const headers: Record<string, string> = { Accept: "application/json" };
      if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
      const res = await fetch(urlCheck.normalized, { headers, next: { revalidate: 300 } }).catch(() => null);
      if (!res?.ok) return null;
      const json = await res.json();
      const mrrVal = Number(json.mrr ?? json.monthlyRecurringRevenue ?? 0) || 0;
      const totVal = Number(json.totalRevenue ?? json.revenue ?? mrrVal) || 0;
      return {
        mrr: Math.round(mrrVal),
        totalRevenue: Math.round(totVal),
        netVolume30Days: Math.round(Number(json.netVolume30Days ?? mrrVal) || 0),
        payingCustomers: Number(json.payingCustomers ?? json.customers ?? 0) || 0,
        activeSubscriptions: Number(json.activeSubscriptions ?? json.subscriptions ?? 0) || 0,
        currency: String(json.currency || "USD").toUpperCase(),
        provider: "hybrid",
        isDemo: false,
        history: Array.isArray(json.history) ? json.history : [{ date: today, amount: Math.round(mrrVal) }],
        recentTransactions: Array.isArray(json.recentTransactions) ? json.recentTransactions.slice(0, 25) : [],
      };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Universal Revenue Fetcher
 * Aggregates built-in Stripe/Dodo + any modular payment connectors into ONE combined MRR dashboard.
 */
export async function fetchRevenueStats(config?: {
  stripeKey?: string | null;
  dodoKey?: string | null;
  dodoEnv?: string | null;
  githubSponsorsUsername?: string | null;
  modularConnectors?: ModularPaymentConnectorInput[];
}): Promise<RevenueStats | null> {
  const tasks: Array<{ provider: string; label: string; promise: Promise<RevenueStats | null> }> = [];

  if (config?.stripeKey) {
    tasks.push({ provider: "stripe", label: "Stripe", promise: fetchStripeRevenue(config.stripeKey) });
  }
  if (config?.dodoKey) {
    tasks.push({
      provider: "dodo",
      label: "Dodo Payments",
      promise: fetchDodoRevenue(config.dodoKey, config.dodoEnv || "live"),
    });
  }
  for (const conn of config?.modularConnectors || []) {
    tasks.push({
      provider: conn.provider,
      label: conn.label,
      promise: fetchModularConnectorRevenue(conn),
    });
  }

  if (tasks.length === 0) return null;

  const settled = await Promise.all(
    tasks.map(async (t) => ({ ...t, res: await t.promise.catch(() => null) }))
  );
  const active = settled.filter((s): s is { provider: string; label: string; promise: Promise<RevenueStats | null>; res: RevenueStats } => Boolean(s.res));
  if (active.length === 0) return null;

  // Providers return at most 25-50 recent transactions, so risk is a recent sample, not the full 30-day ledger.
  // A source at or above the smallest cap (25) is treated as possibly truncated.
  const buildRevenueRisk = (items: RevenueStats[]) => summarizeRevenueAtRisk(
    items.flatMap((item) => item.recentTransactions.map((tx) => ({
      amountMinor: Math.round(tx.amount * 10 ** currencyMinorUnitDigits(tx.currency)),
      currency: tx.currency,
      status: tx.status,
      createdAt: tx.date,
      provider: tx.provider,
    }))),
    new Date(),
    { sampleLimited: items.some((item) => item.recentTransactions.length >= 25) },
  );

  if (active.length === 1) {
    const single = active[0].res;
    return {
      ...single,
      revenueAtRisk: buildRevenueRisk([single]),
      providerBreakdown: [
        {
          provider: active[0].provider,
          label: active[0].label,
          mrr: single.mrr,
          totalRevenue: single.totalRevenue,
          payingCustomers: single.payingCustomers,
          activeSubscriptions: single.activeSubscriptions,
          currency: single.currency,
        },
      ],
    };
  }

  const combinedDateMap: Record<string, number> = {};
  const allTx: TransactionItem[] = [];
  const breakdown: ProviderBreakdownItem[] = [];
  let totalMrr = 0;
  let totalRev = 0;
  let totalNet30 = 0;
  let totalCust = 0;
  let totalSubs = 0;

  for (const item of active) {
    const r = item.res;
    totalMrr += r.mrr;
    totalRev += r.totalRevenue;
    totalNet30 += r.netVolume30Days;
    totalCust += r.payingCustomers;
    totalSubs += r.activeSubscriptions;
    breakdown.push({
      provider: item.provider,
      label: item.label,
      mrr: r.mrr,
      totalRevenue: r.totalRevenue,
      payingCustomers: r.payingCustomers,
      activeSubscriptions: r.activeSubscriptions,
      currency: r.currency,
    });
    for (const h of r.history || []) {
      combinedDateMap[h.date] = (combinedDateMap[h.date] || 0) + h.amount;
    }
    allTx.push(...(r.recentTransactions || []));
  }

  const history = Object.entries(combinedDateMap)
    .map(([date, amount]) => ({ date, amount }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const currencies = Array.from(new Set(active.map((item) => item.res.currency.toUpperCase())));
  const hasOneCurrency = currencies.length === 1;
  return {
    mrr: hasOneCurrency ? totalMrr : 0,
    totalRevenue: hasOneCurrency ? totalRev : 0,
    netVolume30Days: hasOneCurrency ? totalNet30 : 0,
    payingCustomers: totalCust,
    activeSubscriptions: totalSubs,
    currency: hasOneCurrency ? currencies[0] : "MULTI",
    provider: "hybrid",
    isDemo: false,
    history: hasOneCurrency && history.length > 0 ? history : [{ date: new Date().toISOString().split("T")[0], amount: 0 }],
    recentTransactions: allTx.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 10),
    revenueAtRisk: buildRevenueRisk(active.map((item) => item.res)),
    providerBreakdown: breakdown,
  };
}
