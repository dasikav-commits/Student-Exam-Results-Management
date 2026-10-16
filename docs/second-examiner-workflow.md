# Second Examiner workflow and grading

## Setup and use

1. In **Admin → Users**, enable Second Examiner capability on the examiner's lecturer profile.
2. In **Admin → Modules**, assign that person as the module's Second Examiner. They must differ from the First Examiner. Assignments are locked while submitted, frozen, or finalised.
3. The **First Examiner (Module Lecturer)** configures the blueprint. MCQ individual weighting defaults to enabled for existing blueprints. Disabling it applies a single common maximum to every MCQ question, including new questions. Re-enabling restores individual maxima. MCQs remain all-compulsory.
4. The blueprint also stores a **required / optional** second-checking statement. This is an informational statement for the HOD; it does not bypass handover, completeness, or reconciliation rules.
5. Complete and save the marks, then choose **Send to Second Examiner**. Faculty and HOD remain available as the other two recipients of the same handover transition. The explicit Second Examiner option requires an assignment.
6. Second marking cannot save before handover. The First Examiner's ledger, blueprint, and cohort are locked during second checking; **Recall Submission** reopens them while second checking is pending.
7. The correction ledger starts with the First Examiner's marks, overlaid with existing second marks. Saving writes only `secondExamMarks` and final-paper absence flags; original First Examiner marks are preserved. Rose cells and the edited-question count identify numeric changes. Hovering shows the original value. Empty correction entries are seeded again from originals on reload; explicit zero corrections are retained.
8. Finalisation still uses the weighted variance threshold of **1**. Larger differences require First Examiner approval followed by Second Examiner reconciliation finalisation. Post-finalisation and reconciliation-pending second-marking edits are locked.
9. The First Examiner sees per-question second-marking columns after finalisation/reconciliation begins. HOD Result Sheets show side-by-side raw section totals, edited-section highlighting (including changes that cancel out in the total), weighted variance, handover/recall details, and the required/optional statement. The previously hidden HOD examiner columns, Hub, and assignment controls remain hidden.

## Grade and display rules

- The shared grade library includes letter, grade point, and description for all supplied bands.
- Grades use the **unrounded** weighted module mark, not the displayed ceiling: **69.5 → displayed 70, grade A-**.
- Any recorded CA/Theory/Practical/Final absence gives **I**. Zero is **E**; a missing entry alone does not give I (completion/validation flags still apply).
- Marksheet summary, CSV, print/PDF, and HOD results show component/weighted marks to two decimals and individual Module/Grand totals rounded up to a whole number. Averages retain two decimals.
- Scoring no longer truncates totals to one decimal before grading; rounding belongs to presentation.
- The Lecturer marksheet/exports continue to describe the First Examiner's marks, with second-marking comparison data. HOD results retain their existing Second Examiner precedence when second marks are present.

## Data and privacy

No Prisma migration is required. Workflow and MCQ settings live in `Module.stats`; corrections use the existing `StudentMark.secondExamMarks` column.

The examiner marks endpoint selects only final-paper marks, identifiers, eligibility, and final absence flags. It does **not** select or return `caQuestionsMarks` or `isAbsentCa`. Pure examiners do not run the Lecturer Desk's CA fetch, and dual-role users' Lecturer Desk lists only modules where they are the First Examiner. Examiner, HOD, and Admin pages have capability/role render guards.

**Existing security limitation:** authentication in this repository is browser-local (`localStorage`); login does not establish a server-verified session. Existing lecturer/HOD/admin APIs have no server-side role authorization. The field allowlist and UI guards above are not a substitute for API authorization and cannot stop a direct call to another role's API. Server-verified sessions and authorization across **all** privileged APIs are required before treating this as a secure production role boundary. This change does not introduce a new authentication architecture.

## Verification

Run `npm test` for database-free unit and route-handler tests. Route tests install a fail-closed Prisma double; they do not verify a real database transaction or browser flow.

Covered: all grade boundaries; raw grading versus ceiling; absence versus zero; scoring precision; MCQ normalisation/common overrides/reload/individual restoration; legacy blueprints; seeding/edit detection; CSV/print grade output; examiner response selection; handover gates; correction-only saves; variance finalisation; explicit assignment requirement; handover and recall; first/second marking locks; Admin assignment validation; optional statement persistence; existing Faculty/HOD recipients.

The baseline has Prisma JSON TypeScript errors and existing ESLint diagnostics. Compare against the starting commit rather than interpreting those as new regressions. A seeded-database/browser check is still needed for the full manual workflow, including the approval/reconciled-finalisation path.
