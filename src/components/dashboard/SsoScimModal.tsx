"use client";

import React from "react";
import { KeyRound, X } from "lucide-react";
import { SsoScimPanel } from "./SsoScimPanel";

interface SsoScimModalProps {
  isOpen: boolean;
  onClose: () => void;
  isDemo?: boolean;
}

export function SsoScimModal({ isOpen, onClose, isDemo = false }: SsoScimModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="w-full max-w-4xl bg-zinc-900 border border-zinc-700 rounded-2xl shadow-2xl p-6 text-left relative max-h-[92vh] flex flex-col">
        <div className="flex items-center justify-between mb-4 pb-3 border-b border-zinc-800">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-cyan-950 border border-cyan-700/60 flex items-center justify-center text-cyan-400">
              <KeyRound className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-bold text-white text-base">
                Enterprise SSO (SAML 2.0) &amp; SCIM 2.0 Provisioning
              </h3>
              <p className="text-xs text-zinc-400">
                Okta • Microsoft Entra ID (Azure AD) • Google Workspace • Automatic User Provisioning &amp; Offboarding
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-zinc-400 hover:text-white p-1.5 rounded-lg hover:bg-zinc-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto pr-1">
          <SsoScimPanel isDemo={isDemo} />
        </div>
      </div>
    </div>
  );
}
