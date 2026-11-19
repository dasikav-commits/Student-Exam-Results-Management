// The standalone application’s ten moderation criteria, kept in the same order.
export const criteria = [
  ["standardAppropriate", "The questions are up to the standard appropriate for the level being assessed."],
  ["coversMainContents", "The paper appropriately covers the main contents of the syllabus."],
  ["assessesLearningOutcomes", "The questions assess the learning outcomes appropriately."],
  ["clearAndUnambiguous", "Questions are clear and unambiguous."],
  ["appropriateTimeAllocation", "Time allocation is appropriate."],
  ["appropriateMarkAllocation", "Mark allocation is appropriate."],
  ["appropriateNumberingAndFormatting", "Question numbering, page numbering, and formatting are appropriate."],
  ["clearFigures", "Figures are clear and correctly labelled."],
  ["accurateModelAnswers", "Model answers are accurate."],
  ["structuredModelAnswers", "Model answers include an appropriate breakdown of marks."],
] as const;

export const fileSlots = [
  ["paperPdf", "Exam paper (PDF)", ".pdf"], ["paperWord", "Exam paper (Word)", ".docx"],
  ["schemePdf", "Marking scheme (PDF)", ".pdf"], ["schemeWord", "Marking scheme (Word)", ".docx"],
] as const;
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
