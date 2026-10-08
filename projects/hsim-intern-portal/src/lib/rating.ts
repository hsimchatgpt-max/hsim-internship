/** Average of the five ratings, rounded to one decimal. */
export function overallRating(r: { work_quality: number; learning_progress: number; task_completion: number; punctuality: number; communication: number }) {
  return Math.round(((r.work_quality + r.learning_progress + r.task_completion + r.punctuality + r.communication) / 5) * 10) / 10;
}
