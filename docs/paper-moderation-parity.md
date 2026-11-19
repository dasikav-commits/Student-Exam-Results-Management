# Paper Moderation in Exam Results

This is the follow-up to PR #15, which integrated only reference tracking. The standalone version audited for this follow-up was [Paper-Moderation-System `Dasika` at `c55687a`](https://github.com/dasikav-commits/Paper-Moderation-System/commit/c55687a66ddeaff0037bb6b8d76ae0d8d2676f09).

## Feature mapping

| Standalone workflow | In the combined app |
| --- | --- |
| Login, lecturer registration, contact/profile, and changing passwords | Use the Results login, **Create an account**, and **Profile & Settings**. When moderation is enabled, signup includes department and optional phone; the profile shows the department and lets you update the phone. There is no second password/account for moderation. |
| Faculty Board verification, lecturer roster, subjects, assignments | A department’s HOD records panel decisions, controls additional (read-only) course lecturers, and sets the default academic period under **Paper Moderation → Academic settings & Faculty Board panel**. Use the existing Results HOD console for module creation and the active lecturer assignment, and **Admin → Modules** for the Second Examiner assignment. New self-registered users start pending for moderation; existing users with an examiner/lecturer capability retain access unless the HOD revokes it. An approval does not grant a Results capability. |
| Department/subject views, dashboards, archive, academic year and semester | Shared workspace with assigned modules, each paper’s review and document history, filters for search/year/semester/status, and a department-scoped **HOD handoff inbox**. No separate Results and Moderation subject records are required. |
| Drafts and submission | The First Examiner (Results module lecturer) can save a private draft, revise it, and submit it to the assigned Second Examiner. Each bundle contains the question paper and marking scheme, both as PDF and Word (`.docx`). Sample files are available for testing. Unsubmitted versions do not appear to reviewers. |
| Moderation form, feedback, revision, and report | The Second Examiner answers the standalone ten-point checklist, uploads a signature image, and requests revision or approves. The setter can upload a new bundle for another review or record how the feedback was addressed in the final package. Signed report downloads (PDF/Word) include comments, checklist answers, and the final follow-up actions and both signature images after handoff. The stored signatures are image sign-offs, not cryptographic identity certificates. |
| Lecturer revision and password-protected final handoff | The First Examiner uploads the final four files, follow-up actions, and their signature, sets a package password, and sends the package to HOD. The final files are encrypted before saving (AES-256 PDF and Office encrypted DOCX). With both a valid login/assignment and the package password, the setter, assigned moderator, and HOD of the department can download protected originals or unlocked copies. Open downloaded PDFs in your local viewer. The system does not show or email the password; share it separately via an approved private channel. |

## Update an existing local checkout

After the PR is merged, update `Dasika`. Use your **Results** `.env` only. `DATABASE_URL` and `DIRECT_URL` must target the same test Results database; `DIRECT_URL` is the non-pooled connection for migrations. Keep `NEXT_PUBLIC_PAPER_MODERATION_ENABLED=true` and the existing private `PAPER_MODERATION_SESSION_SECRET` (at least 32 random characters).

```sh
npm ci
npx prisma migrate deploy
npm run dev
```

Run the migration on a fresh or correctly baselined test database. **Do not** use `npm run db:push` (it permits data loss) or re-seed a database with users you intend to keep. Restart and sign in again if the app still has an old browser-only session. The new migration adds columns to the shared schema, so run it with the updated app even if the moderation UI is switched off.

The four department values match the standalone registration options. Existing Results users and modules default to **Computing & Information Systems** (`CIS`) because the previous schema had no department field. **If your existing data spans multiple departments, have your database administrator verify and correct the department assignments on staging before enabling the feature.** New HOD-created modules use the HOD’s department; new users select a department at signup or when an admin provisions them. Moderation visibility and HOD assignment changes are department-scoped when enabled.

## Browser walkthrough

1. On a disposable seeded database, sign in as `deepani.w@wyb.ac.lk` and open **Lecturer Desk → Paper Moderation → CMIS 4222**. Set an unused academic period, choose **Set a new exam paper**, download the four fictional samples, upload them, then **Save draft**. Confirm you can download the files and **Submit saved draft**.
2. Use a separate browser profile as `asanka.s@wyb.ac.lk`. Open **Paper Moderation → My assignments**. Open the uploaded draft, complete the ten checklist items, attach a fictional PNG/JPEG signature and **Request revision**. Confirm the setter can download the signed PDF and Word reports. To exercise re-review, have the setter update the submission with a new bundle and have the moderator review again.
3. As the setter, open **Finalise and send to HOD** after the signed review. Supply the four final files, follow-up actions, a fictional setter signature, and a unique 12+ character package password (no spaces). Confirm the status changes to **Sent to HOD**.
4. As HOD, open **HOD handoff inbox**. Try the wrong password first, then use the correct password to download the package. Open the protected PDF/DOCX in a compatible viewer, and download a signed report that includes the follow-up actions and both signatures. Test an unassigned lecturer and a HOD from another department: neither should see or download the package.
5. Open the Results marksheet separately and verify that Paper Moderation did not alter marks, blueprints, grading, or marksheet finalisation.

## Compatibility and operational limits

- No old accounts, paper history, or storage objects are imported. It is possible to continue a reference-only pilot record: **Add files and request a new review** to enter the signed document workflow. An old notes-only approval cannot be used to send a final package without a signed review.
- Only ordinary, unlocked PDF and modern `.docx` inputs are accepted. Convert legacy binary `.doc` files to `.docx` before upload; there is no unencrypted fallback. The entire upload, including all four files and any signature, must fit within 4 MiB. Signatures must be PNG/JPEG and at most 512 KiB. Drafts/signatures are stored in PostgreSQL behind the server authorization boundary; finalized packages are stored encrypted. Review retention, database storage/backup access, file scanning, download rate limiting, and the existing legacy Results API authorization before handling real exam papers. This is not a full production security review.
- This version keeps one paper per module/year/semester. The same login, modules, HOD/Admin tools, and profile serve both workflows rather than mirroring the standalone UI. Some pre-existing Results TypeScript build diagnostics remain; `npm run dev` is the local test path.

## Rollback and validation

Disable `NEXT_PUBLIC_PAPER_MODERATION_ENABLED` and rebuild/restart to run Results without moderation. This retains both datasets. The immediate pre-follow-up code is `9b0e08a6364127da8ff49dd1651bf485085babc5`; the pre-integration Results baseline is `725785c7ab647beab5a41af8aa5c594c48a40d6b`. If rolling back code to PR #15, **keep moderation disabled** against a database that contains `DRAFT`/`FINALIZED` states: the older client does not know those enum values. Do not reset the database to roll back the UI. The new tables/columns are additive and should be archived separately if a schema rollback is required.

`npm test` runs the regression and upload validation tests. Set `MODERATION_TEST_DATABASE_URL` to a disposable, fully migrated database to include both database integration tests. They cover the original pilot and the document workflow including unauthorized and cross-department access, protected/unlocked PDF and Word downloads, report export, and unchanged marks. The setter → moderator → HOD workflow was also exercised in Chromium.
