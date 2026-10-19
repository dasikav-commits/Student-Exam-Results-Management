# Second Examiner workflow and grading

## Setup and use

1. In **Admin → Users**, enable Second Examiner capability on the examiner's lecturer profile.
2. In **Admin → Modules**, assign that person as the module's Second Examiner. They must differ from the First Examiner. Assignments are locked while submitted, frozen, or finalised.
3. The **First Examiner (Module Lecturer)** configures the blueprint. Final Paper MCQ individual weighting defaults to enabled for existing blueprints. Disabling it applies a single common maximum to every MCQ question, including new questions. Re-enabling restores individual maxima. Final Paper MCQs remain all-compulsory. Written CA components have the same weighting control plus a required-answer count (see the next section).
4. The blueprint also stores a **required / optional** second-checking statement. This is an informational statement for the HOD; it does not bypass handover, completeness, or reconciliation rules.
5. Complete and save the marks, then choose **Send to Second Examiner**. Faculty and HOD remain available as the other two recipients of the same handover transition. The explicit Second Examiner option requires an assignment.
6. Second marking cannot save before handover. The First Examiner's ledger, blueprint, and cohort are locked during second checking; **Recall Submission** reopens them while second checking is pending.
7. The correction ledger starts with the First Examiner's marks, overlaid with existing second marks. Saving writes only `secondExamMarks` and final-paper absence flags; original First Examiner marks are preserved. Rose cells and the edited-question count identify numeric changes. Hovering shows the original value. Empty correction entries are seeded again from originals on reload; explicit zero corrections are retained.
8. Finalisation still uses the weighted variance threshold of **1**. Larger differences require First Examiner approval followed by Second Examiner reconciliation finalisation. Post-finalisation and reconciliation-pending second-marking edits are locked.
9. The First Examiner sees per-question second-marking columns after finalisation/reconciliation begins. HOD Result Sheets show side-by-side raw section totals, edited-section highlighting (including changes that cancel out in the total), weighted variance, handover/recall details, and the required/optional statement. The previously hidden HOD examiner columns, Hub, and assignment controls remain hidden.

## Written CA components and highest-scoring required answers

**Types.** Group A components (Project, Presentation, Lab report) keep one overall mark per student and are unchanged. Group B components (Quiz, Assignment, Midterm, Tutorial and **MCQ**) record one mark per question.

**Weighting.** Every Group B component has the same **Enable · Individual weights / Disable · Common weight** control as the Final MCQ editor. Individual mode gives each question its own maximum. Common mode uses one maximum for every question, including questions added later. The individual maxima are kept while hidden, so toggling, saving, reloading and switching back restores them.

**Required answers (highest scores count).** Each Group B CA component, and each optional Final Essay and Practical section, has a required-answer count N. N survives weighting toggles, saving and reloading, and question-count edits, and is capped at the configured question count. Blueprints saved before this control require every answer. **Final Paper MCQ stays all-compulsory**; optional Final MCQs would be a separate policy and UI change.

**Scoring.**

- A student may answer more than N questions. Every entered mark stays stored, and only the **N highest marks earned** count toward the total. Each examiner's final-paper marks are ranked independently, so the First and Second Examiner can count different questions.
- Each mark is clamped to its own question maximum before ranking. Ranking is by raw marks earned, not by percentage of the question maximum. Ties go to natural question order (Q2 before Q10).
- The component maximum is a fixed denominator: the sum of the N highest configured question maxima, whichever questions the student answered. With equal maxima this is N × the maximum.
- **SUM** adds the counted answers. **AVG** divides the counted answers by N and scores them out of the mean of the N highest maxima, so a perfect AVG component reaches 100%.
- Example: six questions of 10 marks, N = 4, marks 1, 2, 3, 4, 9, 10 → counted Q6, Q5, Q4, Q3 = **26 / 40 (65%)**. The dialogs label each score **Counted in total** or **Outside highest scores**.
- **Policy assumption to confirm:** when question maxima are *unequal*, ranking by marks earned and dividing by the N highest maxima is an implementation choice, not a documented department rule. It lives in the shared selection helpers in `src/lib/lecturer-marks.ts`, so changing it means editing those helpers and their tests together.

**Completion.** Any N configured answers complete a component or section; they need not be Q1…QN. This applies to the Lecturer Desk progress, First Examiner submission validation and Second Examiner finalisation. Fewer than N is blocked (`X of N required answers recorded`). Extra answers never block; a CA warning says only the highest N count. Zero is an entered answer; a blank or null is not. Marks for question IDs that are not configured never count toward completeness or totals.

**Behaviour changes for existing sheets.** Scores are recalculated whenever a sheet is read or exported, so sheets that were already signed off should be reviewed before release.

- Results are **unchanged** for a SUM component when all answers are required (every component created by the previous editor) or when the question maxima are equal and the student answered exactly N questions. The same holds for Final Essay and Practical sections with equal maxima whose answers sit on the first N questions.
- With **unequal maxima and N below the question count**, the denominator is now the N highest maxima rather than the first N, so the maximum shown can change.
- Results change where a student answered **more than N**: the highest N now count instead of the first N. Final Essay and Practical previously counted only the first N configured questions.
- **AVG components with N > 1 change for every student.** Previously the mean of the counted answers was divided by the *sum* of the first N maxima, so a perfect four-question AVG component scored only 25% of its weight. It now scores 100%. Review any AVG components before release.
- Marks for unconfigured question IDs no longer count, and an over-range mark is clamped to its own question maximum.

## Grade and display rules

- The shared grade library includes letter, grade point, and description for all supplied bands.
- Grades use the **unrounded** weighted module mark, not the displayed ceiling: **69.5 → displayed 70, grade A-**.
- Any recorded CA/Theory/Practical/Final absence gives **I**. Zero is **E**; a missing entry alone does not give I (completion/validation flags still apply).
- Marksheet summary, CSV, print/PDF, and HOD results show component/weighted marks to two decimals and individual Module/Grand totals rounded up to a whole number. Averages retain two decimals. The **Grade** column remains on the Marksheet Summary, CSV, full print/PDF and HOD Result Sheets; there are no per-question grades.
- Scoring no longer truncates totals to one decimal before grading; rounding belongs to presentation.
- The Lecturer marksheet/exports continue to describe the First Examiner's marks, with second-marking comparison data. HOD results retain their existing Second Examiner precedence when second marks are present.

## Data and privacy

No Prisma migration is required. Workflow, MCQ and written-CA settings live in `Module.stats` (CA settings are the optional `weightingMode`, `commonMaxMarks`, `individualQuestionMarks` and `questionsToAnswer` fields on each Group B entry of `caComponents`; `questionMarks` always holds the effective maxima). Components saved earlier default to individual weighting with every answer required. Corrections use the existing `StudentMark.secondExamMarks` column.

The examiner marks endpoint selects only final-paper marks, identifiers, eligibility, and final absence flags. It does **not** select or return `caQuestionsMarks` or `isAbsentCa`. Pure examiners do not run the Lecturer Desk's CA fetch, and dual-role users' Lecturer Desk lists only modules where they are the First Examiner. Examiner, HOD, and Admin pages have capability/role render guards.

**Existing security limitation:** authentication in this repository is browser-local (`localStorage`); login does not establish a server-verified session. Existing lecturer/HOD/admin APIs have no server-side role authorization. The field allowlist and UI guards above are not a substitute for API authorization and cannot stop a direct call to another role's API. Server-verified sessions and authorization across **all** privileged APIs are required before treating this as a secure production role boundary. This change does not introduce a new authentication architecture.

## Verification

Run `npm test` for database-free unit and route-handler tests. Route tests install a fail-closed Prisma double; they do not verify a real database transaction or browser flow.

Covered: all grade boundaries; raw grading versus ceiling; absence versus zero; scoring precision; MCQ normalisation/common overrides/reload/individual restoration; legacy blueprints; seeding/edit detection; CSV/print grade output; examiner response selection; handover gates; correction-only saves; variance finalisation; explicit assignment requirement; handover and recall; first/second marking locks; Admin assignment validation; optional statement persistence; existing Faculty/HOD recipients.

Also covered for written CA and optional Final sections (`scripts/tests/ca-best-n.test.ts` and the route tests): the MCQ type and unchanged Group A; the weighting toggle round trip through JSON and the normaliser; common weight for questions added later; required answers surviving weighting, save and resizing; blueprint validation; highest-N selection (the 26 / 40 example, unequal maxima, SUM and AVG, ties in natural order, clamping, zero versus blank, unknown IDs); any-N completion in progress, handover and finalisation for both examiners, with extra answers only warning; saving keeps every entered answer; CSV, CA print and full print agreement; the rendered Summary Grade header and cells; and the Counted / Outside labels in both dialogs.

The baseline has Prisma JSON TypeScript errors and existing ESLint diagnostics. Compare against the starting commit rather than interpreting those as new regressions. A seeded-database/browser check is still needed for the full manual workflow, including the approval/reconciled-finalisation path.

Manual checks that automated tests cannot cover (no browser or database was used):

- In the CA blueprint editor, toggle a Group B component to common weight, save, reload, and switch back; the individual maxima must return. Add a question in common mode and confirm it takes the common weight. Edit the question count and confirm Required answers is kept (and capped).
- Enter 1, 2, 3, 4, 9, 10 on a six-question component with four required answers: the dialog shows **26 / 40** with Q6, Q5, Q4 and Q3 labelled **Counted in total**. Answering only Q3–Q6 marks the row complete; answering three does not.
- Repeat for an optional Final Essay and Practical section as both First and Second Examiner, including a handover and a finalisation.
- Compare the register, Marksheet Summary, CSV, full print, CA print and HOD Result Sheets for the same student; they must agree. Check 69.5 shows 70 with A-, an absence shows I, and zero shows E.
- Review sheets that were already signed off (see *Behaviour changes for existing sheets*).
