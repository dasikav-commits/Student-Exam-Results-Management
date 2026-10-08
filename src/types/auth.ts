import { z } from "zod";

export const loginSchema = z.object({
  email: z
    .string()
    .min(1, "Email or Username is required")
    .email("Please enter a valid university email address")
    .refine((val) => val.endsWith("@wyb.ac.lk") || val.endsWith(".wyb.ac.lk"), {
      message: "Must use a valid Wayamba University domain account",
    }),
  
  password: z
    .string()
    .min(1, "Password is required")
    .min(8, "Password must be at least 8 characters long")
    .max(50, "Password is too long"),
    
  rememberMe: z.boolean().optional(),
});

export type LoginInput = z.infer<typeof loginSchema>;

export type UserRole = "ADMIN" | "STUDENT" | "LECTURER";

// ── Lecturer self-service signup ─────────────────────────────────────────────

export const UNIVERSITY_EMAIL_DOMAINS = ["wayamba.ac.lk", "wyb.ac.lk"] as const;

export function isUniversityEmail(email: string): boolean {
  const normalized = email.trim().toLowerCase();
  const at = normalized.lastIndexOf("@");
  if (at <= 0) return false;
  const domain = normalized.slice(at + 1);
  return (UNIVERSITY_EMAIL_DOMAINS as readonly string[]).includes(domain);
}

// Fields accepted by POST /api/auth/signup.
export const signupRequestSchema = z.object({
  fullName: z
    .string()
    .trim()
    .min(2, "Full name is required")
    .max(100, "Full name is too long"),

  email: z
    .string()
    .trim()
    .min(1, "University email is required")
    .email("Please enter a valid email address")
    .refine(isUniversityEmail, {
      message: "Use your university email (@wayamba.ac.lk or @wyb.ac.lk)",
    }),

  password: z
    .string()
    .min(8, "Password must be at least 8 characters long")
    .max(50, "Password is too long"),
});

// Form schema: adds the confirmation field, checked on the client.
export const signupSchema = z
  .object({
    fullName: signupRequestSchema.shape.fullName,
    email: signupRequestSchema.shape.email,
    password: signupRequestSchema.shape.password,
    confirmPassword: z.string().min(1, "Please confirm your password"),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

export type SignupInput = z.infer<typeof signupSchema>;
