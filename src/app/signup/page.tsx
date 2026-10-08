"use client";

import React, { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { User, Mail, Lock, Eye, EyeOff, Loader2, CheckCircle2 } from "lucide-react";
import { signupSchema, SignupInput } from "@/types/auth";

const inputClass = (hasError: boolean) =>
  `block w-full pl-10 pr-3 py-2.5 bg-slate-50 border ${
    hasError ? "border-red-500 focus:ring-red-500" : "border-slate-300 focus:ring-indigo-600"
  } rounded-xl text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:bg-white transition-all text-sm`;

export default function SignupPage() {
  const [showPassword, setShowPassword] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [registeredEmail, setRegisteredEmail] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<SignupInput>({
    resolver: zodResolver(signupSchema),
    defaultValues: {
      fullName: "",
      email: "",
      password: "",
      confirmPassword: "",
    },
  });

  const onSubmit = async (data: SignupInput) => {
    setServerError(null);
    try {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullName: data.fullName,
          email: data.email,
          password: data.password,
        }),
      });

      const result = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(result.error || "Could not create your account. Please try again.");
      }

      setRegisteredEmail(data.email.trim().toLowerCase());
    } catch (err: unknown) {
      setServerError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col md:flex-row">
      {/* Left Column: Branding Sidebar */}
      <div className="hidden md:flex md:w-1/2 bg-indigo-900 text-white p-12 flex-col justify-between relative overflow-hidden">
        <div className="absolute top-0 left-0 w-96 h-96 bg-indigo-800 rounded-full mix-blend-multiply filter blur-3xl opacity-30 -translate-x-20 -translate-y-20" />
        <div className="absolute bottom-0 right-0 w-96 h-96 bg-indigo-700 rounded-full mix-blend-multiply filter blur-3xl opacity-20 translate-x-20 translate-y-20" />

        <div className="relative z-10 flex items-center space-x-3">
          <img src="/wusl-logo.png" alt="Wayamba University" className="h-12 w-12 object-contain" />
          <div>
            <span className="font-bold text-sm tracking-wider uppercase text-indigo-100">Wayamba University of Sri Lanka</span>
          </div>
        </div>

        <div className="relative z-10 my-auto max-w-lg space-y-4">
          <h1 className="text-4xl font-extrabold tracking-tight leading-none text-white">
            Student Exam &amp; Results Management
          </h1>
          <p className="text-indigo-200 text-lg">
            Create a lecturer account to access mark entry, second examination, and result sheet generation.
          </p>
        </div>

        <div className="relative z-10 border-t border-indigo-800 pt-6 text-xs text-indigo-300">
          &copy; {new Date().getFullYear()} Wayamba University of Sri Lanka. All Rights Reserved.
        </div>
      </div>

      {/* Right Column: Signup Form */}
      <div className="flex-1 flex items-center justify-center p-6 sm:p-12 bg-slate-50">
        <div className="w-full max-w-md space-y-8 bg-white p-8 rounded-2xl shadow-sm border border-slate-200">
          <div className="text-center md:text-left">
            <h2 className="text-3xl font-bold tracking-tight text-slate-900">Create Lecturer Account</h2>
            <p className="mt-2 text-sm text-slate-600">
              Use your university email. An administrator will grant any teaching or examination access after signup.
            </p>
          </div>

          {registeredEmail ? (
            <div className="space-y-6">
              <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl text-sm text-emerald-800 flex items-start gap-3">
                <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" />
                <div>
                  <p className="font-semibold">Account created</p>
                  <p className="mt-1">
                    You can now sign in as <span className="font-semibold">{registeredEmail}</span>. Module access is
                    assigned by an administrator.
                  </p>
                </div>
              </div>
              <Link
                href="/login"
                className="w-full flex justify-center items-center py-3 px-4 rounded-xl shadow-sm text-sm font-bold text-white bg-indigo-900 hover:bg-indigo-950 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-600 transition-all"
              >
                Back to Sign In
              </Link>
            </div>
          ) : (
            <>
              {serverError && (
                <div role="alert" className="p-4 bg-red-50 border border-red-200 rounded-xl text-sm text-red-600">
                  {serverError}
                </div>
              )}

              <form onSubmit={handleSubmit(onSubmit)} className="space-y-6" noValidate>
                {/* Full Name */}
                <div>
                  <label htmlFor="fullName" className="block text-sm font-semibold text-slate-700 mb-2">
                    Full Name
                  </label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                      <User className="h-5 w-5" />
                    </div>
                    <input
                      {...register("fullName")}
                      id="fullName"
                      type="text"
                      autoComplete="name"
                      placeholder="Dr. Jane Perera"
                      className={inputClass(!!errors.fullName)}
                    />
                  </div>
                  {errors.fullName && (
                    <p className="mt-1.5 text-xs font-medium text-red-600">{errors.fullName.message}</p>
                  )}
                </div>

                {/* University Email */}
                <div>
                  <label htmlFor="email" className="block text-sm font-semibold text-slate-700 mb-2">
                    University Email Address
                  </label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                      <Mail className="h-5 w-5" />
                    </div>
                    <input
                      {...register("email")}
                      id="email"
                      type="email"
                      autoComplete="email"
                      placeholder="name@wayamba.ac.lk"
                      className={inputClass(!!errors.email)}
                    />
                  </div>
                  {errors.email && (
                    <p className="mt-1.5 text-xs font-medium text-red-600">{errors.email.message}</p>
                  )}
                </div>

                {/* Password */}
                <div>
                  <label htmlFor="password" className="block text-sm font-semibold text-slate-700 mb-2">
                    Password
                  </label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                      <Lock className="h-5 w-5" />
                    </div>
                    <input
                      {...register("password")}
                      id="password"
                      type={showPassword ? "text" : "password"}
                      autoComplete="new-password"
                      placeholder="At least 8 characters"
                      className={`${inputClass(!!errors.password)} pr-10`}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      aria-label={showPassword ? "Hide password" : "Show password"}
                      className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-600"
                    >
                      {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                    </button>
                  </div>
                  {errors.password && (
                    <p className="mt-1.5 text-xs font-medium text-red-600">{errors.password.message}</p>
                  )}
                </div>

                {/* Confirm Password */}
                <div>
                  <label htmlFor="confirmPassword" className="block text-sm font-semibold text-slate-700 mb-2">
                    Confirm Password
                  </label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                      <Lock className="h-5 w-5" />
                    </div>
                    <input
                      {...register("confirmPassword")}
                      id="confirmPassword"
                      type={showPassword ? "text" : "password"}
                      autoComplete="new-password"
                      placeholder="Re-enter your password"
                      className={inputClass(!!errors.confirmPassword)}
                    />
                  </div>
                  {errors.confirmPassword && (
                    <p className="mt-1.5 text-xs font-medium text-red-600">{errors.confirmPassword.message}</p>
                  )}
                </div>

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full flex justify-center items-center py-3 px-4 border border-transparent rounded-xl shadow-sm text-sm font-bold text-white bg-indigo-900 hover:bg-indigo-950 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-600 disabled:opacity-50 disabled:cursor-not-allowed transition-all cursor-pointer"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" />
                      <span>Creating account...</span>
                    </>
                  ) : (
                    "Create Account"
                  )}
                </button>
              </form>

              <p className="text-center text-sm text-slate-600">
                Already have an account?{" "}
                <Link href="/login" className="font-bold text-indigo-600 hover:text-indigo-500">
                  Sign in
                </Link>
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
