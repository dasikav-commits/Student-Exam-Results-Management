"use client";

import React, { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { Lock, Mail, Eye, EyeOff, Loader2, Award } from "lucide-react";
import { loginSchema, LoginInput } from "@/types/auth";
import { useAuth } from "@/context/AuthContext";

export default function LoginPage() {
  const { login } = useAuth();
  const [showPassword, setShowPassword] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginInput>({
    // NOTE: If client validation rejects `@wayamba.ac.lk`, check your zod rule in `@/types/auth`
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: "",
      password: "",
      rememberMe: false,
    },
  });

  const onSubmit = async (data: LoginInput) => {
    setServerError(null);
    try {
      const cleanEmail = data.email.toLowerCase().trim();

      if (!cleanEmail.endsWith("@wayamba.ac.lk") && !cleanEmail.endsWith("@wyb.ac.lk")) {
        throw new Error("Must use a valid Wayamba University domain account (@wayamba.ac.lk or @wyb.ac.lk)");
      }

      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: cleanEmail, password: data.password }),
      });

      const result = await res.json();

      if (!res.ok) {
        throw new Error(result.error || "Authentication failed. Please check your credentials.");
      }

      // AuthContext.login() handles session storage + role-based routing
      login(result.user, result.token ?? "");

    } catch (err: any) {
      setServerError(err?.message || "Invalid credentials or server error.");
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col md:flex-row">
      
      {/* Left Column: Branding Sidebar */}
      <div className="hidden md:flex md:w-1/2 bg-indigo-900 text-white p-12 flex-col justify-between relative overflow-hidden">
        {/* Abstract background decorative accents */}
        <div className="absolute top-0 left-0 w-96 h-96 bg-indigo-800 rounded-full mix-blend-multiply filter blur-3xl opacity-30 -translate-x-20 -translate-y-20" />
        <div className="absolute bottom-0 right-0 w-96 h-96 bg-indigo-700 rounded-full mix-blend-multiply filter blur-3xl opacity-20 translate-x-20 translate-y-20" />

        <div className="relative z-10 flex items-center space-x-3">
          <Award className="h-10 w-10 text-indigo-300" />
          <span className="font-bold text-xl tracking-wider uppercase">WUSL Gateway</span>
        </div>

        <div className="relative z-10 my-auto max-w-lg space-y-4">
          <h1 className="text-4xl font-extrabold tracking-tight leading-none text-white">
            Examination Management & Mark Auditing System
          </h1>
          <p className="text-indigo-200 text-lg">
            Secure processing hub for grading workflows, evaluation configurations, and unified student mark auditing dashboards.
          </p>
        </div>

        <div className="relative z-10 border-t border-indigo-800 pt-6 text-xs text-indigo-300">
          &copy; {new Date().getFullYear()} Wayamba University of Sri Lanka. All Rights Reserved.
        </div>
      </div>

      {/* Right Column: Portal Login Form */}
      <div className="flex-1 flex items-center justify-center p-6 sm:p-12 bg-slate-50">
        <div className="w-full max-w-md space-y-8 bg-white p-8 rounded-2xl shadow-sm border border-slate-200">
          
          <div className="text-center md:text-left">
            <h2 className="text-3xl font-bold tracking-tight text-slate-900">
              Account Sign In
            </h2>
            <p className="mt-2 text-sm text-slate-600">
              Access the examination management interface.
            </p>
          </div>

          {serverError && (
            <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-sm text-red-600 animate-pulse">
              {serverError}
            </div>
          )}

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
            
            {/* Username/Email Input Container */}
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
                  type="text"
                  placeholder="lec2@wayamba.ac.lk"
                  className={`block w-full pl-10 pr-3 py-2.5 bg-slate-50 border ${
                    errors.email ? "border-red-500 focus:ring-red-500" : "border-slate-300 focus:ring-indigo-600"
                  } rounded-xl text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:bg-white transition-all text-sm`}
                />
              </div>
              {errors.email && (
                <p className="mt-1.5 text-xs font-medium text-red-600">{errors.email.message}</p>
              )}
            </div>

            {/* Password Input Container */}
            <div>
              <label htmlFor="password" className="block text-sm font-semibold text-slate-700 mb-2">
                Security Password
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                  <Lock className="h-5 w-5" />
                </div>
                <input
                  {...register("password")}
                  id="password"
                  type={showPassword ? "text" : "password"}
                  placeholder="••••••••"
                  className="block w-full pl-10 pr-10 py-2.5 bg-slate-50 border border-slate-300 focus:ring-indigo-600 rounded-xl text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:bg-white transition-all text-sm"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-600"
                >
                  {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                </button>
              </div>
            </div>

            {/* Remember Me Option */}
            <div className="flex items-center justify-between">
              <div className="flex items-center">
                <input
                  {...register("rememberMe")}
                  id="rememberMe"
                  type="checkbox"
                  className="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-slate-300 rounded"
                />
                <label htmlFor="rememberMe" className="ml-2 block text-sm font-medium text-slate-700 select-none">
                  Keep me signed in
                </label>
              </div>
              <div className="text-sm">
                <Link href="/forgot-password" className="font-bold text-indigo-600 hover:text-indigo-500">
                  Forgot password?
                </Link>
              </div>
            </div>

            {/* Execution Trigger Button */}
            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full flex justify-center items-center py-3 px-4 border border-transparent rounded-xl shadow-sm text-sm font-bold text-white bg-indigo-900 hover:bg-indigo-950 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-600 disabled:opacity-50 disabled:cursor-not-allowed transition-all cursor-pointer"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" />
                  <span>Authenticating System...</span>
                </>
              ) : (
                "Sign In to Gateway"
              )}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}