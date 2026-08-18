import type { Octokit } from "@octokit/rest";

export interface CommitFile {
  path: string;
  content: string;
}

/**
 * Creates one git commit per submission via the GitHub API. The branch ref is
 * updated after every commit, so progress survives partial failures: the next
 * run picks up from the watermark visible in history.
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
          content: f.content,
          encoding: "utf-8",
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

    await this.octokit.git.updateRef({
      owner: this.owner,
      repo: this.repo,
      ref: `heads/${this.branch}`,
      sha: commit.data.sha,
      force: false,
    });

    this.headSha = commit.data.sha;
    this.treeSha = commit.data.tree.sha;
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
