"use client";

import React, { useState } from "react";
import Link from "next/link";
import { GraduationCap, ArrowLeft, Loader2, MailCheck, AlertCircle } from "lucide-react";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);

    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Something went wrong. Please try again.");
      } else {
        // Success regardless of whether email was actually found (security)
        setIsSuccess(true);
      }
    } catch {
      setError("Network error. Please try again later.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-cream-canvas overflow-hidden relative">
      
      {/* Background aesthetics */}
      <div className="absolute top-0 w-full h-1/2 bg-gradient-to-b from-blue-50/50 to-transparent pointer-events-none" />
      <div className="absolute -top-32 -left-32 w-96 h-96 bg-indigo-200 rounded-full mix-blend-multiply filter blur-3xl opacity-20 animate-blob" />
      <div className="absolute top-32 -right-32 w-96 h-96 bg-sky-200 rounded-full mix-blend-multiply filter blur-3xl opacity-20 animate-blob animation-delay-2000" />

      <div className="w-full max-w-md bg-white rounded-[2rem] p-8 sm:p-10 shadow-2xl relative z-10 border border-neutral-100/50">
        
        {/* Header */}
        <div className="flex flex-col items-center text-center mb-8">
          <div className="h-14 w-14 bg-gradient-to-br from-[#1a1a1a] to-[#333] rounded-2xl flex items-center justify-center shadow-inner mb-5">
            <GraduationCap className="h-7 w-7 text-white" />
          </div>
          <h1 className="text-2xl font-black tracking-tight text-[#1a1a1a] mb-2">Reset Password</h1>
          <p className="text-xs font-semibold text-neutral-500 max-w-[280px]">
            Enter your university email address and we'll send you a link to reset your password.
          </p>
        </div>

        {isSuccess ? (
          <div className="bg-emerald-50 border border-emerald-100 rounded-2xl p-6 text-center">
            <div className="h-12 w-12 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <MailCheck className="h-6 w-6 text-emerald-600" />
            </div>
            <h3 className="text-sm font-bold text-emerald-800 mb-2">Check your email</h3>
            <p className="text-xs text-emerald-600/90 mb-6">
              If an account with a recovery email exists for <span className="font-bold">{email}</span>, you will receive a password reset link shortly.
            </p>
            <Link 
              href="/login"
              className="inline-flex items-center justify-center gap-2 text-[11px] font-bold text-emerald-700 bg-emerald-100 hover:bg-emerald-200 px-4 py-2 rounded-lg transition-colors"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Back to Login
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-[10px] font-bold text-neutral-500 uppercase tracking-wider mb-2 ml-1">
                University Email Address
              </label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="e.g. staff@wyb.ac.lk"
                className="w-full bg-neutral-50/50 border border-neutral-200 text-neutral-800 text-sm font-semibold rounded-xl px-4 py-3.5 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all placeholder:text-neutral-400 placeholder:font-medium"
              />
            </div>

            {error && (
              <div className="flex items-start gap-2.5 p-3 rounded-xl bg-rose-50 border border-rose-100 text-rose-600 text-xs font-semibold animate-in fade-in slide-in-from-top-1">
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                <p>{error}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full h-12 flex items-center justify-center gap-2 bg-[#1a1a1a] hover:bg-neutral-800 text-white font-bold text-sm rounded-xl transition-all shadow-lg shadow-neutral-900/10 active:scale-[0.98] disabled:opacity-70 disabled:active:scale-100 cursor-pointer"
            >
              {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Send Reset Link"}
            </button>
            
            <div className="text-center pt-2">
              <Link href="/login" className="inline-flex items-center gap-1.5 text-xs font-bold text-neutral-500 hover:text-[#1a1a1a] transition-colors">
                <ArrowLeft className="h-3.5 w-3.5" />
                Back to Login
              </Link>
            </div>
          </form>
        )}

      </div>
    </div>
  );
}
