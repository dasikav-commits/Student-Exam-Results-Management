"use client";

import React, { useState, useEffect } from "react";
import { X, User, Mail, Shield, Save, Loader2, CheckCircle2, AlertCircle, KeyRound } from "lucide-react";
import { useAuth } from "@/context/AuthContext";

interface ProfileSettingsDrawerProps {
  isOpen: boolean;
  onClose: () => void;
}

export function ProfileSettingsDrawer({ isOpen, onClose }: ProfileSettingsDrawerProps) {
  const { user } = useAuth();
  
  // Profile state
  const [fullName, setFullName] = useState("");
  const [recoveryEmail, setRecoveryEmail] = useState("");
  const [isProfileLoading, setIsProfileLoading] = useState(false);
  const [isProfileSaving, setIsProfileSaving] = useState(false);
  const [profileFeedback, setProfileFeedback] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Password state
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isPasswordSaving, setIsPasswordSaving] = useState(false);
  const [passwordFeedback, setPasswordFeedback] = useState<{ type: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    if (isOpen && user) {
      loadProfile();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, user]);

  const loadProfile = async () => {
    setIsProfileLoading(true);
    try {
      const res = await fetch(`/api/auth/profile?email=${encodeURIComponent(user?.email || "")}`);
      if (res.ok) {
        const data = await res.json();
        setFullName(data.fullName || "");
        setRecoveryEmail(data.recoveryEmail || "");
      }
    } catch (err) {
      console.error("Failed to load profile", err);
    } finally {
      setIsProfileLoading(false);
    }
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsProfileSaving(true);
    setProfileFeedback(null);
    try {
      const res = await fetch("/api/auth/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: user?.email, fullName, recoveryEmail }),
      });
      const result = await res.json();
      if (res.ok) {
        setProfileFeedback({ type: "success", text: "Profile details updated successfully." });
      } else {
        setProfileFeedback({ type: "error", text: result.error || "Failed to update profile." });
      }
    } catch {
      setProfileFeedback({ type: "error", text: "Network error. Please try again." });
    } finally {
      setIsProfileSaving(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      setPasswordFeedback({ type: "error", text: "New passwords do not match." });
      return;
    }
    if (newPassword.length < 8) {
      setPasswordFeedback({ type: "error", text: "Password must be at least 8 characters long." });
      return;
    }

    setIsPasswordSaving(true);
    setPasswordFeedback(null);
    try {
      const res = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: user?.email, currentPassword, newPassword }),
      });
      const result = await res.json();
      if (res.ok) {
        setPasswordFeedback({ type: "success", text: "Password changed successfully." });
        setCurrentPassword("");
        setNewPassword("");
        setConfirmPassword("");
      } else {
        setPasswordFeedback({ type: "error", text: result.error || "Failed to change password." });
      }
    } catch {
      setPasswordFeedback({ type: "error", text: "Network error. Please try again." });
    } finally {
      setIsPasswordSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div 
        className="fixed inset-0 bg-neutral-900/40 backdrop-blur-sm z-[100] transition-opacity"
        onClick={onClose}
      />
      
      {/* Drawer */}
      <div className="fixed inset-y-0 right-0 w-full max-w-md bg-cream-canvas shadow-2xl z-[110] flex flex-col border-l border-neutral-200/80 animate-in slide-in-from-right duration-300">
        
        {/* Header */}
        <div className="px-6 py-4 bg-white border-b border-neutral-200/80 flex items-center justify-between shrink-0">
          <div>
            <h2 className="text-sm font-black text-[#1a1a1a]">Profile & Settings</h2>
            <p className="text-[11px] text-neutral-400 mt-0.5">Manage your personal details and security.</p>
          </div>
          <button 
            onClick={onClose}
            className="p-2 -mr-2 text-neutral-400 hover:text-[#1a1a1a] hover:bg-neutral-50 rounded-xl transition-colors cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          
          {/* Section 1: Personal Details */}
          <div className="bg-white rounded-2xl premium-border p-5">
            <div className="flex items-center gap-2 mb-4">
              <User className="h-4 w-4 text-indigo-600" />
              <h3 className="text-sm font-bold text-[#1a1a1a]">Personal Details</h3>
            </div>
            
            {isProfileLoading ? (
              <div className="flex justify-center py-6">
                <Loader2 className="h-5 w-5 text-indigo-600 animate-spin" />
              </div>
            ) : (
              <form onSubmit={handleSaveProfile} className="space-y-4">
                
                <div>
                  <label className="block text-[10px] font-bold text-neutral-500 uppercase tracking-wider mb-1">University Email (Login ID)</label>
                  <input 
                    type="email" 
                    value={user?.email || ""} 
                    disabled
                    className="w-full bg-neutral-50 border border-neutral-200 rounded-lg px-3 py-2 text-xs font-semibold text-neutral-500" 
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-neutral-500 uppercase tracking-wider mb-1">Roles</label>
                  <div className="flex flex-wrap gap-1.5">
                    {user?.role === "ADMIN" && <span className="bg-rose-50 text-rose-700 border border-rose-200 text-[9px] font-bold px-2 py-0.5 rounded uppercase tracking-wide">System Admin</span>}
                    {user?.capabilities.isHOD && <span className="bg-indigo-50 text-indigo-700 border border-indigo-200 text-[9px] font-bold px-2 py-0.5 rounded uppercase tracking-wide">HOD</span>}
                    {user?.capabilities.isActiveLec && <span className="bg-emerald-50 text-emerald-700 border border-emerald-200 text-[9px] font-bold px-2 py-0.5 rounded uppercase tracking-wide">Active Lecturer</span>}
                    {user?.capabilities.isExamLec && <span className="bg-amber-50 text-amber-700 border border-amber-200 text-[9px] font-bold px-2 py-0.5 rounded uppercase tracking-wide">Examiner</span>}
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-neutral-500 uppercase tracking-wider mb-1">Full Name</label>
                  <input 
                    type="text" 
                    required
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="Dr. Example Name"
                    className="w-full bg-white border border-neutral-200 rounded-lg px-3 py-2 text-xs font-semibold focus:outline-none focus:border-indigo-500" 
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-neutral-500 uppercase tracking-wider mb-1">Recovery Email</label>
                  <input 
                    type="email" 
                    value={recoveryEmail}
                    onChange={(e) => setRecoveryEmail(e.target.value)}
                    placeholder="personal@gmail.com"
                    className="w-full bg-white border border-neutral-200 rounded-lg px-3 py-2 text-xs font-semibold focus:outline-none focus:border-indigo-500" 
                  />
                  <p className="text-[10px] text-neutral-400 mt-1">We will send password reset links to this address if you get locked out.</p>
                </div>

                {profileFeedback && (
                  <div className={`p-2.5 rounded-lg border flex items-start gap-2 text-[11px] font-semibold ${profileFeedback.type === "success" ? "bg-emerald-50 border-emerald-200 text-emerald-800" : "bg-rose-50 border-rose-200 text-rose-800"}`}>
                    {profileFeedback.type === "success" ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0" /> : <AlertCircle className="h-3.5 w-3.5 shrink-0" />}
                    {profileFeedback.text}
                  </div>
                )}

                <div className="pt-2">
                  <button 
                    type="submit" 
                    disabled={isProfileSaving}
                    className="w-full flex items-center justify-center gap-2 h-9 px-4 text-xs font-bold bg-[#1a1a1a] text-white rounded-lg hover:bg-neutral-800 disabled:opacity-50 transition-all cursor-pointer"
                  >
                    {isProfileSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                    Save Details
                  </button>
                </div>
              </form>
            )}
          </div>

          {/* Section 2: Change Password */}
          <div className="bg-white rounded-2xl premium-border p-5">
            <div className="flex items-center gap-2 mb-4">
              <KeyRound className="h-4 w-4 text-orange-600" />
              <h3 className="text-sm font-bold text-[#1a1a1a]">Change Password</h3>
            </div>
            
            <form onSubmit={handleChangePassword} className="space-y-4">
              <div>
                <label className="block text-[10px] font-bold text-neutral-500 uppercase tracking-wider mb-1">Current Password</label>
                <input 
                  type="password" 
                  required
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  className="w-full bg-white border border-neutral-200 rounded-lg px-3 py-2 text-xs font-semibold focus:outline-none focus:border-orange-500" 
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold text-neutral-500 uppercase tracking-wider mb-1">New Password</label>
                <input 
                  type="password" 
                  required
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Min 8 characters"
                  className="w-full bg-white border border-neutral-200 rounded-lg px-3 py-2 text-xs font-semibold focus:outline-none focus:border-orange-500" 
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold text-neutral-500 uppercase tracking-wider mb-1">Confirm New Password</label>
                <input 
                  type="password" 
                  required
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full bg-white border border-neutral-200 rounded-lg px-3 py-2 text-xs font-semibold focus:outline-none focus:border-orange-500" 
                />
              </div>

              {passwordFeedback && (
                <div className={`p-2.5 rounded-lg border flex items-start gap-2 text-[11px] font-semibold ${passwordFeedback.type === "success" ? "bg-emerald-50 border-emerald-200 text-emerald-800" : "bg-rose-50 border-rose-200 text-rose-800"}`}>
                  {passwordFeedback.type === "success" ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0" /> : <AlertCircle className="h-3.5 w-3.5 shrink-0" />}
                  {passwordFeedback.text}
                </div>
              )}

              <div className="pt-2">
                <button 
                  type="submit" 
                  disabled={isPasswordSaving}
                  className="w-full flex items-center justify-center gap-2 h-9 px-4 text-xs font-bold bg-neutral-100 text-[#1a1a1a] border border-neutral-200 rounded-lg hover:bg-neutral-200 disabled:opacity-50 transition-all cursor-pointer"
                >
                  {isPasswordSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Shield className="h-3.5 w-3.5" />}
                  Update Password
                </button>
              </div>
            </form>
          </div>

        </div>
      </div>
    </>
  );
}
