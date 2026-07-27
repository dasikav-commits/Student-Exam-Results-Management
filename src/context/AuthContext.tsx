"use client";

import React, { createContext, useContext, useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { AuthContextType, UserSession } from "@/types/user";

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<UserSession | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const router = useRouter();

  // ── Session restore on mount ─────────────────────────────────────────────
  useEffect(() => {
    const stored = localStorage.getItem("weg_user_session");
    if (stored) {
      try {
        const parsed: UserSession = JSON.parse(stored);
        // Guard against stale admin-root dev tokens leaking into production
        if (parsed && parsed.id !== "admin-root") {
          setUser(parsed);
          setIsLoading(false);
          return;
        }
      } catch {
        localStorage.removeItem("weg_user_session");
      }
    }
    // No valid stored session — clear state and go to login
    setUser(null);
    setIsLoading(false);
  }, []);

  const login = (sessionData: UserSession, token: string) => {
    setIsLoading(true);
    localStorage.setItem("weg_auth_token", token);
    localStorage.setItem("weg_user_session", JSON.stringify(sessionData));
    setUser(sessionData);
    setIsLoading(false);

    // Role-based routing
    if (sessionData.role === "ADMIN") {
      router.push("/dashboard/admin");
    } else if (sessionData.role === "LECTURER") {
      // HOD gets HOD console first; they can switch to lecturer/examiner from there
      if (sessionData.capabilities.isHOD) router.push("/dashboard/hod");
      else if (sessionData.capabilities.isActiveLec) router.push("/dashboard/lecturer");
      else if (sessionData.capabilities.isExamLec) router.push("/dashboard/examiner");
      else router.push("/dashboard/lecturer");
    }
  };

  const logout = () => {
    localStorage.removeItem("weg_auth_token");
    localStorage.removeItem("weg_user_session");
    setUser(null);
    router.push("/login");
  };

  return (
    <AuthContext.Provider value={{ user, isAuthenticated: !!user, isLoading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider setup");
  }
  return context;
}