const jobs = new Map<string, AbortController>();

export function registerChatJob(messageId: string): AbortController {
  jobs.get(messageId)?.abort();
  const abort = new AbortController();
  jobs.set(messageId, abort);
  return abort;
}

export function hasChatJob(messageId: string): boolean {
  return jobs.has(messageId);
}

export function cancelChatJob(messageId: string): boolean {
  const job = jobs.get(messageId);
  if (!job) return false;
  job.abort();
  jobs.delete(messageId);
  return true;
}

export function finishChatJob(messageId: string) {
  jobs.delete(messageId);
}
