export const moderationDepartments = ["CIS", "ELECTRONICS", "INDUSTRIAL", "MATHEMATICS"] as const;
export const DEFAULT_MODERATION_DEPARTMENT = "CIS";
export const moderationDepartmentNames: Record<(typeof moderationDepartments)[number], string> = {
  CIS: "Computing & Information Systems",
  ELECTRONICS: "Electronics",
  INDUSTRIAL: "Industrial Management",
  MATHEMATICS: "Mathematical Sciences",
};
