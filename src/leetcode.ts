import type { Question, SubmissionDetails, SubmissionListEntry } from "./types";

const BASE_URL = "https://leetcode.com";
const GRAPHQL_URL = `${BASE_URL}/graphql`;
const USER_AGENT = "leech/0.1";

/** A normalized page of submissions (the wire shape lives in ListResponse). */
interface SubmissionPage {
  hasMore: boolean;
  submissions: SubmissionListEntry[];
}

interface ListResponse {
  data: {
    submissionList: {
      hasNext: boolean;
      submissions: SubmissionListEntry[];
    };
  };
}

interface SubmissionDetailsResponse {
  data: {
    submissionDetails: {
      id: number;
      timestamp: number;
      statusDisplay: string;
      lang: { name: string } | null;
      code: string | null;
      runtime: string | null;
      memory: string | null;
      runtimePercentile: number | null;
      memoryPercentile: number | null;
    } | null;
  };
}

interface QuestionResponse {
  data: {
    question: {
      questionId: string;
      questionFrontendId: string;
      title: string;
      titleSlug: string;
      difficulty: string;
      isPaidOnly: boolean;
      content: string | null;
      stats: string | null;
      topicTags: { name: string; slug: string }[];
    } | null;
  };
}

const SUBMISSION_LIST_QUERY = `
query submissionList($offset: Int!, $limit: Int!, $slug: String) {
  submissionList(offset: $offset, limit: $limit, questionSlug: $slug) {
    hasNext
    submissions {
      id
      lang
      timestamp
      statusDisplay
      runtime
      title
      memory
      titleSlug
    }
  }
}`;

const SUBMISSION_DETAILS_QUERY = `
query submissionDetails($submissionId: Int!) {
  submissionDetails(submissionId: $submissionId) {
    id
    timestamp
    statusDisplay
    lang { name }
    code
    runtime
    memory
    runtimePercentile
    memoryPercentile
  }
}`;

const QUESTION_QUERY = `
query questionData($titleSlug: String!) {
  question(titleSlug: $titleSlug) {
    questionId
    questionFrontendId
    title
    titleSlug
    difficulty
    isPaidOnly
    content
    stats
    topicTags { name slug }
  }
}`;

export class LeetCodeClient {
  private readonly session: string;
  private readonly csrf: string;
  private readonly delayMs: number;

  constructor(session: string, csrf: string, delayMs: number) {
    this.session = session;
    this.csrf = csrf;
    this.delayMs = delayMs;
  }

  private headers(extra?: Record<string, string>): Record<string, string> {
    return {
      cookie: `LEETCODE_SESSION=${this.session}; csrftoken=${this.csrf}`,
      "x-csrftoken": this.csrf,
      origin: BASE_URL,
      referer: BASE_URL,
      "user-agent": USER_AGENT,
      ...extra,
    };
  }

  private async request<T>(url: string, init?: RequestInit): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(url, init);
      if (res.status === 401 || res.status === 403) {
        throw new Error(
          "LeetCode rejected the session cookie (HTTP 401/403). The cookies " +
            "have likely expired — refresh LEETCODE_SESSION and csrftoken from your browser."
        );
      }
      if ((res.status === 429 || res.status >= 500) && attempt < 2) {
        await this.sleep(1000 * (attempt + 1));
        continue;
      }
      if (!res.ok) {
        throw new Error(
          `LeetCode request failed: HTTP ${res.status} ${res.statusText} (${url})`
        );
      }
      return (await res.json()) as T;
    }
  }

  private async sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async throttle(): Promise<void> {
    if (this.delayMs > 0) await this.sleep(this.delayMs);
  }

  /** Fetch one page of submissions (newest first). */
  async listSubmissions(offset: number, limit = 20): Promise<SubmissionPage> {
    await this.throttle();
    const res = await this.request<ListResponse>(GRAPHQL_URL, {
      method: "POST",
      headers: this.headers({ "content-type": "application/json" }),
      body: JSON.stringify({
        query: SUBMISSION_LIST_QUERY,
        variables: { offset, limit, slug: null },
        operationName: "submissionList",
      }),
    });
    const list = res.data?.submissionList;
    // An invalid/expired session yields HTTP 200 with a null submissionList
    // (hasNext/submissions are null), so the 401/403 guard in request() never
    // fires. Fail loudly instead of silently syncing nothing.
    if (!list || list.hasNext === null || list.submissions === null) {
      throw new Error(
        "LeetCode returned no submission list — the session cookie is likely " +
          "invalid or expired. Refresh LEETCODE_SESSION and csrftoken from your browser."
      );
    }
    return {
      hasMore: list.hasNext,
      submissions: list.submissions,
    };
  }

  /** Fetch full details (code, stats) for a single submission. */
  async getSubmissionDetails(
    submissionId: number
  ): Promise<SubmissionDetails | null> {
    await this.throttle();
    const res = await this.request<SubmissionDetailsResponse>(GRAPHQL_URL, {
      method: "POST",
      headers: this.headers({ "content-type": "application/json" }),
      body: JSON.stringify({
        query: SUBMISSION_DETAILS_QUERY,
        variables: { submissionId },
        operationName: "submissionDetails",
      }),
    });
    const d = res.data?.submissionDetails;
    if (!d) return null;
    return {
      id: d.id,
      timestamp: d.timestamp,
      statusDisplay: d.statusDisplay,
      lang: d.lang?.name ?? "",
      code: d.code ?? "",
      runtime: d.runtime,
      memory: d.memory,
      runtimePercentile: d.runtimePercentile,
      memoryPercentile: d.memoryPercentile,
    };
  }

  /** Fetch problem metadata + HTML description. Returns null for locked (premium) problems. */
  async getQuestion(titleSlug: string): Promise<Question | null> {
    await this.throttle();
    const res = await this.request<QuestionResponse>(GRAPHQL_URL, {
      method: "POST",
      headers: this.headers({ "content-type": "application/json" }),
      body: JSON.stringify({
        query: QUESTION_QUERY,
        variables: { titleSlug },
        operationName: "questionData",
      }),
    });
    const q = res.data?.question;
    if (!q) return null;

    let acceptance: number | null = null;
    try {
      const stats = JSON.parse(q.stats ?? "{}") as { acceptanceRate?: number };
      acceptance =
        typeof stats.acceptanceRate === "number" ? stats.acceptanceRate : null;
    } catch {
      /* stats is optional */
    }

    return {
      frontendId: q.questionFrontendId,
      title: q.title,
      titleSlug: q.titleSlug,
      difficulty: q.difficulty as Question["difficulty"],
      tags: q.topicTags.map((t) => t.name),
      contentHtml: q.content ?? "",
      acceptanceRate: acceptance,
      isPaidOnly: q.isPaidOnly,
    };
  }
}
