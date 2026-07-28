"use client";

import React, { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { GraduationCap, ArrowRight, Loader2, AlertCircle, CheckCircle2 } from "lucide-react";

function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token");

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setError("Invalid or missing reset token. Please request a new password reset link.");
    }
  }, [token]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (newPassword !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    
    if (newPassword.length < 8) {
      setError("Password must be at least 8 characters long.");
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, newPassword }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Something went wrong. Please try again.");
      } else {
        setIsSuccess(true);
        setTimeout(() => {
          router.push("/login");
        }, 3000);
      }
    } catch {
      setError("Network error. Please try again later.");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isSuccess) {
    return (
      <div className="bg-emerald-50 border border-emerald-100 rounded-2xl p-6 text-center animate-in zoom-in-95">
        <div className="h-12 w-12 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <CheckCircle2 className="h-6 w-6 text-emerald-600" />
        </div>
        <h3 className="text-sm font-bold text-emerald-800 mb-2">Password Reset Successful</h3>
        <p className="text-xs text-emerald-600/90 mb-6">
          Your password has been successfully updated. Redirecting you to login...
        </p>
        <Link 
          href="/login"
          className="inline-flex items-center justify-center gap-2 text-[11px] font-bold text-emerald-700 bg-emerald-100 hover:bg-emerald-200 px-4 py-2 rounded-lg transition-colors"
        >
          Go to Login Now <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div>
        <label className="block text-[10px] font-bold text-neutral-500 uppercase tracking-wider mb-2 ml-1">
          New Password
        </label>
        <input
          type="password"
          required
          disabled={!token}
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          placeholder="Minimum 8 characters"
          className="w-full bg-neutral-50/50 border border-neutral-200 text-neutral-800 text-sm font-semibold rounded-xl px-4 py-3.5 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all placeholder:text-neutral-400 placeholder:font-medium"
        />
      </div>

      <div>
        <label className="block text-[10px] font-bold text-neutral-500 uppercase tracking-wider mb-2 ml-1">
          Confirm New Password
        </label>
        <input
          type="password"
          required
          disabled={!token}
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          className="w-full bg-neutral-50/50 border border-neutral-200 text-neutral-800 text-sm font-semibold rounded-xl px-4 py-3.5 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
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
        disabled={isSubmitting || !token}
        className="w-full h-12 flex items-center justify-center gap-2 bg-[#1a1a1a] hover:bg-neutral-800 text-white font-bold text-sm rounded-xl transition-all shadow-lg shadow-neutral-900/10 active:scale-[0.98] disabled:opacity-70 disabled:active:scale-100 cursor-pointer"
      >
        {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save New Password"}
      </button>
    </form>
  );
}

export default function ResetPasswordPage() {
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
          <h1 className="text-2xl font-black tracking-tight text-[#1a1a1a] mb-2">Set New Password</h1>
          <p className="text-xs font-semibold text-neutral-500 max-w-[280px]">
            Please enter your new password below. Make sure it's secure!
          </p>
        </div>

        <Suspense fallback={<div className="flex justify-center p-4"><Loader2 className="h-6 w-6 animate-spin text-neutral-400" /></div>}>
          <ResetPasswordForm />
        </Suspense>

      </div>
    </div>
  );
}
