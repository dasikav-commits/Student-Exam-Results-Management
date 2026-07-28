"use client";

import React, { useState, useEffect } from "react";
import { useAuth } from "@/context/AuthContext";
import { ProfileSettingsDrawer } from "@/components/ProfileSettingsDrawer";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import { 
  Key, 
  Sliders, 
  Flame, 
  Trash2, 
  UserPlus, 
  BookOpen, 
  Search,
  Loader2,
  X,
  ChevronDown,
  LogOut,
  Lock,
  User,
  Mail
} from "lucide-react";

interface SystemUser {
  id: string;
  email: string;
  fullName: string;
  role: "ADMIN" | "LECTURER";
  department: string;
  recoveryEmail?: string;
  capabilities: {
    isHOD: boolean;
    isActiveLec: boolean;
    isExamLec: boolean;
  };
}

interface AcademicModule {
  id: string;
  code: string;
  name: string;
  assignedLecturerName: string;
  totalStudents: number;
}

export default function AdminDashboard() {
  useRequireAuth();  // ← redirects to /login if no session
  const { logout } = useAuth();
  const [activeTab, setActiveTab] = useState<"USERS" | "MODULES">("USERS");
  const [searchQuery, setSearchQuery] = useState("");

  // Control state to toggle account side-drawer modal visibility
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isProfileOpen, setIsProfileOpen] = useState(false);

  const [users, setUsers] = useState<SystemUser[]>([]);
  const [modules, setModules] = useState<AcademicModule[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Form input field states
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [role, setRole] = useState<"ADMIN" | "LECTURER">("LECTURER");
  const [password, setPassword] = useState("");
  const [department, setDepartment] = useState("Computing & Information Systems");
  const [isHod, setIsHod] = useState(false);
  const [isActiveLec, setIsActiveLec] = useState(true);
  const [isExamLec, setIsExamLec] = useState(false);

  useEffect(() => {
    async function bootstrapDashboardData() {
      try {
        const response = await fetch("/api/admin/users");
        if (response.ok) {
          const data = await response.json();
          const transformedUsers = data.map((u: any) => ({
            id: u.id,
            email: u.email,
            fullName: u.fullName,
            role: u.role,
            department: u.department || "Computing & Information Systems",
            recoveryEmail: u.recoveryEmail,
            capabilities: {
              isHOD: u.isHod,
              isActiveLec: u.isActiveLec,
              isExamLec: u.isExamLec
            }
          }));
          setUsers(transformedUsers);
        }
      } catch (err) {
        console.error("Pipeline failure reading users roster:", err);
      } finally {
        setIsLoading(false);
      }
    }
    bootstrapDashboardData();
  }, []);

  const handleCreateUserAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const response = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          fullName,
          role,
          password,
          isHod,
          isActiveLec,
          isExamLec
        })
      });

      const result = await response.json();

      if (response.ok) {
        const newUser: SystemUser = {
          id: result.user?.id || `u-${Date.now()}`,
          email: email.toLowerCase().trim(),
          fullName: fullName.trim(),
          role: role as "ADMIN" | "LECTURER",
          department: department,
          capabilities: { isHOD: isHod, isActiveLec: isActiveLec, isExamLec: isExamLec }
        };

        setUsers(prev => [newUser, ...prev]);
        
        // Reset field matrices back to baseline standards & close modal drawer
        setEmail("");
        setFullName("");
        setPassword("");
        setIsHod(false);
        setIsExamLec(false);
        setIsModalOpen(false);
        alert("System user profile provisioned successfully.");
      } else {
        alert(result.error || "Provisioning interface pipeline rejected configurations.");
      }
    } catch (err) {
      alert("Network handshake fault parsing secure admin commands.");
    }
  };

  const handleDeleteUserAccount = async (userId: string) => {
    const confirmed = window.confirm("Are you absolutely sure you want to permanently delete this user account profile?");
    if (!confirmed) return;

    try {
      const response = await fetch(`/api/admin/users?id=${userId}`, {
        method: "DELETE",
      });

      const result = await response.json();

      if (response.ok) {
        setUsers(prev => prev.filter(user => user.id !== userId));
      } else {
        alert(result.error || "System rejected account destruction instruction.");
      }
    } catch (err) {
      alert("Network handshake fault processing secure administration commands.");
    }
  };

  const toggleCapability = async (userId: string, flag: "isHOD" | "isActiveLec" | "isExamLec") => {
    // Map UI flag names → Prisma field names
    const flagMap: Record<"isHOD" | "isActiveLec" | "isExamLec", "isHod" | "isActiveLec" | "isExamLec"> = {
      isHOD: "isHod",
      isActiveLec: "isActiveLec",
      isExamLec: "isExamLec",
    };
    const dbFlag = flagMap[flag];

    // Capture current value for rollback
    const currentUser = users.find(u => u.id === userId);
    if (!currentUser) return;
    const currentValue = currentUser.capabilities[flag];
    const newValue = !currentValue;

    // Optimistic update — apply immediately so the UI feels instant
    setUsers(prev => prev.map(u => {
      if (u.id === userId) {
        return { ...u, capabilities: { ...u.capabilities, [flag]: newValue } };
      }
      return u;
    }));

    try {
      const response = await fetch("/api/admin/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: userId, flag: dbFlag, value: newValue }),
      });

      if (!response.ok) {
        const result = await response.json();
        throw new Error(result.error || "Server rejected capability update.");
      }
    } catch (err: any) {
      // Rollback to previous value on failure
      setUsers(prev => prev.map(u => {
        if (u.id === userId) {
          return { ...u, capabilities: { ...u.capabilities, [flag]: currentValue } };
        }
        return u;
      }));
      alert(`Failed to save capability change: ${err.message}`);
    }
  };


  const filteredUsers = users.filter(u => 
    u.fullName.toLowerCase().includes(searchQuery.toLowerCase()) ||
    u.email.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="min-h-screen bg-slate-50/50 p-8 text-slate-800">
      
      {/* Structural Header block context */}
      <div className="mb-8 flex flex-col md:flex-row md:items-center md:justify-between gap-4 border-b border-slate-100 pb-5">
        <div className="flex items-center gap-3">
          <img src="/wusl-logo.png" alt="Wayamba University" className="w-10 h-10 object-contain" />
          <div>
            <h1 className="text-2xl font-black tracking-tight text-slate-900">System Control Desk</h1>
            <p className="text-slate-500 text-xs mt-1 font-medium">Student Exam &amp; Results Management · Admin Control Panel</p>
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          <button 
            onClick={() => setActiveTab("USERS")}
            className={`px-4 py-2 rounded-lg font-bold text-xs inline-flex items-center space-x-2 transition-all cursor-pointer ${
              activeTab === "USERS" ? "bg-slate-900 text-white shadow-sm" : "bg-white border border-slate-200 text-slate-600 hover:bg-slate-50"
            }`}
          >
            <UserPlus className="h-3.5 w-3.5" />
            <span>Manage Accounts</span>
          </button>
          <button
            onClick={() => setIsProfileOpen(true)}
            className="px-4 py-2 rounded-lg font-bold text-xs inline-flex items-center space-x-2 bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 transition-all cursor-pointer"
          >
            <User className="h-3.5 w-3.5" />
            <span>Profile Settings</span>
          </button>
          <button
            onClick={logout}
            className="px-4 py-2 rounded-lg font-bold text-xs inline-flex items-center space-x-2 bg-white border border-rose-200 text-rose-600 hover:bg-rose-50 transition-all cursor-pointer"
          >
            <LogOut className="h-3.5 w-3.5" />
            <span>Sign Out</span>
          </button>
        </div>
      </div>

      <ProfileSettingsDrawer isOpen={isProfileOpen} onClose={() => setIsProfileOpen(false)} />

      {/* Main Container - Now expands to full-width beautifully */}
      <div className="w-full bg-white border border-slate-200/80 rounded-xl shadow-sm overflow-hidden flex flex-col">
        
        {/* Quick Filter Search and Creation Action Trigger Toolbar */}
        <div className="p-4 border-b border-slate-100 bg-slate-50/50 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="relative max-w-xs w-full">
            <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-400" />
            <input 
              type="text" 
              placeholder={activeTab === "USERS" ? "Search profiles by email or name..." : "Search modules..."}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-4 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-medium text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
            />
          </div>

          <div className="flex items-center gap-3 w-full sm:w-auto justify-end">
            <span className="text-[11px] font-bold text-slate-400 whitespace-nowrap">
              {activeTab === "USERS" ? `${filteredUsers.length} Records Loaded` : "Active Curriculum Registry"}
            </span>
            {activeTab === "USERS" && (
              <button 
                onClick={() => setIsModalOpen(true)}
                className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-lg shadow-sm transition-all inline-flex items-center space-x-1.5 cursor-pointer"
              >
                <UserPlus className="h-3.5 w-3.5" />
                <span>Create User Profile</span>
              </button>
            )}
          </div>
        </div>

        {/* Main Structural Output Grid Container */}
        <div className="overflow-x-auto">
          {isLoading ? (
            <div className="p-12 text-center flex flex-col justify-center items-center space-y-2">
              <Loader2 className="h-6 w-6 text-blue-600 animate-spin" />
              <span className="text-xs font-bold text-slate-400">Synchronizing system database structures...</span>
            </div>
          ) : (
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-100 text-[10px] uppercase font-black tracking-wider text-slate-400">
                  <th className="p-4 pl-6 w-12">#</th>
                  {activeTab === "USERS" ? (
                    <>
                      <th scope="col" className="px-6 py-3 text-left">Account Details</th>
                      <th scope="col" className="px-6 py-3 text-left">Department</th>
                      <th scope="col" className="px-6 py-3 text-left">Recovery</th>
                      <th scope="col" className="px-6 py-3 text-left">Role Access Matrix</th>
                      <th className="p-4 text-center">Interactive Capabilities Controls Matrix</th>
                    </>
                  ) : (
                    <>
                      <th className="p-4">Code</th>
                      <th className="p-4">Course Module Name</th>
                      <th className="p-4">Assigned Director Core</th>
                      <th className="p-4 pr-6">Roster Metrics</th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs font-medium text-slate-600">
                {activeTab === "USERS" ? (
                  filteredUsers.map((u, idx) => (
                    <tr key={u.id} className="hover:bg-slate-50/50 transition-colors">
                      <td className="p-4 pl-6 font-bold text-slate-400">{idx + 1}</td>
                      <td className="px-6 py-4">
                        <span className="block font-bold text-slate-800 text-sm">{u.fullName}</span>
                        <span className="text-slate-400 font-normal block mt-0.5">{u.email}</span>
                      </td>
                      <td className="px-6 py-4">
                        <span className="inline-block px-2.5 py-1 rounded bg-blue-50 text-blue-600 font-semibold text-[11px]">
                          {u.department}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        {u.recoveryEmail ? (
                          <div className="flex items-center gap-1.5 text-xs text-slate-500 font-medium">
                            <Mail className="h-3 w-3 text-slate-400" />
                            {u.recoveryEmail}
                          </div>
                        ) : (
                          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Not set</span>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`inline-block font-bold px-2.5 py-0.5 rounded text-[10px] uppercase ${
                          u.role === "ADMIN" ? "bg-red-50 text-red-600" : "bg-blue-50 text-blue-600"
                        }`}>
                          {u.role}
                        </span>
                      </td>
                      <td className="p-4 pr-6">
                        <div className="flex justify-center items-center gap-2">
                          {u.role === "ADMIN" ? (
                            /* ── ADMIN accounts: capability controls are locked ── */
                            <div
                              title="Capability controls are restricted to Lecturer accounts only"
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-slate-50 text-slate-400 text-[11px] font-bold select-none"
                            >
                              <Lock className="h-3 w-3" />
                              <span>Controls Locked</span>
                            </div>
                          ) : (
                            /* ── LECTURER accounts: full interactive capability matrix ── */
                            <>
                              <button 
                                onClick={() => toggleCapability(u.id, "isHOD")}
                                className={`px-3 py-1.5 rounded-lg border text-[11px] font-bold inline-flex items-center space-x-1.5 transition-all cursor-pointer ${
                                  u.capabilities.isHOD 
                                    ? "bg-blue-600 border-blue-600 text-white shadow-sm" 
                                    : "bg-white border-slate-200 text-slate-400 hover:border-slate-300 hover:text-slate-700"
                                }`}
                              >
                                <Key className="h-3 w-3" />
                                <span>HOD Console</span>
                              </button>
                              
                              <button 
                                onClick={() => toggleCapability(u.id, "isActiveLec")}
                                className={`px-3 py-1.5 rounded-lg border text-[11px] font-bold inline-flex items-center space-x-1.5 transition-all cursor-pointer ${
                                  u.capabilities.isActiveLec 
                                    ? "bg-blue-600 border-blue-600 text-white shadow-sm" 
                                    : "bg-white border-slate-200 text-slate-400 hover:border-slate-300 hover:text-slate-700"
                                }`}
                              >
                                <Sliders className="h-3 w-3" />
                                <span>Active Lec</span>
                              </button>
                              
                              <button 
                                onClick={() => toggleCapability(u.id, "isExamLec")}
                                className={`px-3 py-1.5 rounded-lg border text-[11px] font-bold inline-flex items-center space-x-1.5 transition-all cursor-pointer ${
                                  u.capabilities.isExamLec 
                                    ? "bg-blue-600 border-blue-600 text-white shadow-sm" 
                                    : "bg-white border-slate-200 text-slate-400 hover:border-slate-300 hover:text-slate-700"
                                }`}
                              >
                                <Flame className="h-3 w-3" />
                                <span>Examiner Desk</span>
                              </button>
                            </>
                          )}

                          <div className="h-5 w-px bg-slate-200 mx-1" />
                          
                          <button 
                            onClick={() => handleDeleteUserAccount(u.id)}
                            title="Permanently Purge Profile Account"
                            className="p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-all border border-transparent hover:border-rose-100 cursor-pointer"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                      </tr>
                    ))
                  ) : (
                    modules.map((m, idx) => (
                      <tr key={m.id} className="hover:bg-slate-50/50 transition-colors">
                        <td className="p-4 pl-6 font-bold text-slate-400">{idx + 1}</td>
                        <td className="p-4">
                          <span className="bg-blue-50 text-blue-700 font-bold px-2 py-0.5 rounded text-[11px] border border-blue-100">
                            {m.code}
                          </span>
                        </td>
                        <td className="p-4 font-bold text-slate-800 text-sm">{m.name}</td>
                        <td className="p-4 font-semibold text-slate-600">{m.assignedLecturerName}</td>
                        <td className="p-4 pr-6 font-bold text-blue-600">
                          {m.totalStudents} Enrolled
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            )}
          </div>
        </div>

      {/* ==================== TRIGGER-DRIVEN OVERLAY SLIDEOVER MODAL ==================== */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-end bg-slate-900/40 backdrop-blur-xs transition-all animate-fade-in">
          <div className="w-full max-w-md h-full bg-white shadow-2xl flex flex-col p-6 overflow-y-auto animate-slide-in">
            
            <div className="flex items-center justify-between pb-4 border-b border-slate-100">
              <div className="space-y-0.5">
                <h3 className="text-base font-black text-slate-900 tracking-tight">Provision User Profile</h3>
                <p className="text-xs text-slate-400">Initialize custom configuration bounds mapping records.</p>
              </div>
              <button 
                onClick={() => setIsModalOpen(false)}
                className="p-1.5 hover:bg-slate-100 text-slate-400 hover:text-slate-600 rounded-lg transition-colors cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleCreateUserAccount} className="flex-1 flex flex-col justify-between mt-6 space-y-5 text-xs">
              <div className="space-y-4">
                <div>
                  <label className="block font-bold text-slate-700 mb-1.5">Full Legal Name</label>
                  <input 
                    type="text" 
                    required
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="e.g. Prof. J.K. Perera"
                    className="w-full px-3.5 py-2.5 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 font-medium text-slate-800 bg-slate-50 focus:bg-white transition-all"
                  />
                </div>

                <div>
                  <label className="block font-bold text-slate-700 mb-1.5">University Email Endpoint</label>
                  <input 
                    type="email" 
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="lecturer@wayamba.ac.lk"
                    className="w-full px-3.5 py-2.5 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 font-medium text-slate-800 bg-slate-50 focus:bg-white transition-all"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block font-bold text-slate-700 mb-1.5">Authorization Role</label>
                    <div className="relative">
                      <select 
                        value={role}
                        onChange={(e) => setRole(e.target.value as "ADMIN" | "LECTURER")}
                        className="w-full px-3.5 py-2.5 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 font-bold text-slate-700 bg-slate-50 appearance-none"
                      >
                        <option value="LECTURER">LECTURER</option>
                        <option value="ADMIN">SYSTEM ADMIN</option>
                      </select>
                      <ChevronDown className="absolute right-3 top-3.5 h-4 w-4 text-slate-400 pointer-events-none" />
                    </div>
                  </div>

                  <div>
                    <label className="block font-bold text-slate-700 mb-1.5">Access Password</label>
                    <input 
                      type="password" 
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••"
                      className="w-full px-3.5 py-2.5 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 font-medium text-slate-800 bg-slate-50 focus:bg-white transition-all"
                    />
                  </div>
                </div>

                <div>
                  <label className="block font-bold text-slate-700 mb-1.5">Department Assignment</label>
                  <div className="relative">
                    <select
                      value={department}
                      onChange={(e) => setDepartment(e.target.value)}
                      className="w-full px-3.5 py-2.5 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 font-bold text-slate-700 bg-slate-50 appearance-none"
                    >
                      <option value="Computing & Information Systems">Computing & Information Systems</option>
                      <option value="Industrial Management">Industrial Management</option>
                      <option value="Electronics">Electronics</option>
                    </select>
                    <ChevronDown className="absolute right-3 top-3.5 h-4 w-4 text-slate-400 pointer-events-none" />
                  </div>
                </div>

                <div className="bg-slate-50 border border-slate-100 rounded-lg p-3.5 space-y-3 mt-2">
                  <span className="block font-black text-slate-800 text-[10px] uppercase tracking-wider">Initial Authority Flags</span>
                  
                  <label className="flex items-center space-x-2.5 cursor-pointer">
                    <input type="checkbox" checked={isHod} onChange={(e) => setIsHod(e.target.checked)} className="rounded border-slate-300 text-blue-600 focus:ring-blue-500/20 h-3.5 w-3.5" />
                    <span className="font-semibold text-slate-600">Assign Head of Department (HOD) Access</span>
                  </label>

                  <label className="flex items-center space-x-2.5 cursor-pointer">
                    <input type="checkbox" checked={isActiveLec} onChange={(e) => setIsActiveLec(e.target.checked)} className="rounded border-slate-300 text-blue-600 focus:ring-blue-500/20 h-3.5 w-3.5" />
                    <span className="font-semibold text-slate-600">Set Active Lecturer Visibility</span>
                  </label>

                  <label className="flex items-center space-x-2.5 cursor-pointer">
                    <input type="checkbox" checked={isExamLec} onChange={(e) => setIsExamLec(e.target.checked)} className="rounded border-slate-300 text-blue-600 focus:ring-blue-500/20 h-3.5 w-3.5" />
                    <span className="font-semibold text-slate-600">Assign Panel Examiner Desk Access</span>
                  </label>
                </div>
              </div>

              <div className="flex space-x-3 pt-4 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="flex-1 py-2.5 border border-slate-200 rounded-xl font-bold text-slate-600 bg-white hover:bg-slate-50 transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button 
                  type="submit"
                  className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-bold py-2.5 rounded-xl shadow-md shadow-blue-600/15 transition-all cursor-pointer"
                >
                  Commit Account Profile
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}