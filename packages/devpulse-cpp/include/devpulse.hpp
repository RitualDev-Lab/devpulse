#pragma once

#include <chrono>
#include <deque>
#include <mutex>
#include <regex>
#include <string>

namespace devpulse {

struct Config {
  std::string api_key;
  std::string endpoint = "https://devpulse.ritualdev.in";
  std::string release = "1.0.0";
  bool scrub_pii = true;
};

struct Breadcrumb {
  long long timestamp;
  std::string category;
  std::string level;
  std::string message;
};

class Client {
 public:
  explicit Client(Config cfg) : cfg_(std::move(cfg)) {}

  static std::string redact_pii(const std::string& input) {
    static const std::regex email_re(R"([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})");
    static const std::regex auth_re(R"(\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+)", std::regex_constants::icase);
    std::string clean = std::regex_replace(input, auth_re, "$1 [REDACTED]");
    return std::regex_replace(clean, email_re, "[REDACTED_EMAIL]");
  }

  void add_breadcrumb(const std::string& category, const std::string& level, std::string message) {
    std::lock_guard<std::mutex> lock(mu_);
    if (cfg_.scrub_pii) message = redact_pii(message);
    auto now = std::chrono::duration_cast<std::chrono::seconds>(
                   std::chrono::system_clock::now().time_since_epoch())
                   .count();
    breadcrumbs_.push_back({now, category, level, std::move(message)});
    if (breadcrumbs_.size() > 40) breadcrumbs_.pop_front();
  }

  std::string build_event_json(const std::string& error_name, std::string message, std::string stack_trace) const {
    if (cfg_.scrub_pii) {
      message = redact_pii(message);
      stack_trace = redact_pii(stack_trace);
    }
    return "{\"apiKey\":\"" + escape(cfg_.api_key) +
           "\",\"errorName\":\"" + escape(error_name) +
           "\",\"message\":\"" + escape(message) +
           "\",\"stackTrace\":\"" + escape(stack_trace) +
           "\",\"runtime\":\"cpp\",\"version\":\"" + escape(cfg_.release) + "\"}";
  }

 private:
  static std::string escape(const std::string& s) {
    std::string out;
    out.reserve(s.size());
    for (char c : s) {
      if (c == '"') out += "\\\"";
      else if (c == '\\') out += "\\\\";
      else if (c == '\n') out += "\\n";
      else if (c != '\r') out += c;
    }
    return out;
  }

  Config cfg_;
  mutable std::mutex mu_;
  std::deque<Breadcrumb> breadcrumbs_;
};

}  // namespace devpulse
