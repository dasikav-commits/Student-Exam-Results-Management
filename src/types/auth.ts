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