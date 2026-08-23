import type { Octokit } from "@octokit/rest";

export interface CommitFile {
  path: string;
  content: string | Buffer;
  /** Content encoding for the blob API; must be "base64" for binary buffers. */
  encoding?: "utf-8" | "base64";
}

/**
 * Creates one git commit per submission via the GitHub API. Commits are
 * chained locally (parent → child) and the branch ref is updated once per
 * sync via {@link flush}, so a run lands atomically: either every submission
 * is pushed or none is.
 */
export class SyncCommitter {
  private readonly octokit: Octokit;
  private readonly owner: string;
  private readonly repo: string;
  private readonly branch: string;
  private readonly authorName: string;
  private readonly authorEmail: string;
  private headSha = "";
  private treeSha = "";
  private committed = 0;

  constructor(
    octokit: Octokit,
    owner: string,
    repo: string,
    branch: string,
    authorName: string,
    authorEmail: string
  ) {
    this.octokit = octokit;
    this.owner = owner;
    this.repo = repo;
    this.branch = branch;
    this.authorName = authorName;
    this.authorEmail = authorEmail;
  }

  async init(): Promise<void> {
    const ref = await this.octokit.git.getRef({
      owner: this.owner,
      repo: this.repo,
      ref: `heads/${this.branch}`,
    });
    this.headSha = ref.data.object.sha;
    const tree = await this.octokit.git.getTree({
      owner: this.owner,
      repo: this.repo,
      tree_sha: this.headSha,
    });
    this.treeSha = tree.data.sha;
  }

  async commitSubmission(
    files: CommitFile[],
    message: string,
    submissionTimestamp: number
  ): Promise<void> {
    const blobs = await Promise.all(
      files.map((f) =>
        this.octokit.git.createBlob({
          owner: this.owner,
          repo: this.repo,
          content:
            typeof f.content === "string"
              ? f.content
              : f.content.toString("base64"),
          encoding: f.encoding ?? "utf-8",
        })
      )
    );

    const tree = await this.octokit.git.createTree({
      owner: this.owner,
      repo: this.repo,
      base_tree: this.treeSha,
      tree: files.map((f, i) => ({
        path: f.path,
        mode: "100644",
        type: "blob" as const,
        sha: blobs[i]!.data.sha,
      })),
    });

    const commit = await this.octokit.git.createCommit({
      owner: this.owner,
      repo: this.repo,
      message,
      tree: tree.data.sha,
      parents: [this.headSha],
      author: {
        name: this.authorName,
        email: this.authorEmail,
        date: new Date(submissionTimestamp * 1000).toISOString(),
      },
      committer: { name: this.authorName, email: this.authorEmail },
    });

    // Chain locally only; the remote ref is advanced once in flush().
    this.headSha = commit.data.sha;
    this.treeSha = commit.data.tree.sha;
    this.committed++;
  }

  /**
   * Push all locally-created commits to the remote branch in a single ref
   * update. No-op (returns 0) when no commits were created, e.g. dry-run or
   * an empty sync. Returns the number of commits pushed.
   */
  async flush(): Promise<number> {
    if (this.committed === 0) return 0;
    await this.octokit.git.updateRef({
      owner: this.owner,
      repo: this.repo,
      ref: `heads/${this.branch}`,
      sha: this.headSha,
      force: false,
    });
    return this.committed;
  }
}

export async function getDefaultBranch(
  octokit: Octokit,
  owner: string,
  repo: string
): Promise<string> {
  const res = await octokit.repos.get({ owner, repo });
  return res.data.default_branch;
}
