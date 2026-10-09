import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const directTag = /^v\d+\.\d+\.\d+$/;

export function releaseRefPolicy(env, version) {
  const event = env.GITHUB_EVENT_NAME || "";
  const ref = env.GITHUB_REF || "";
  const refType = env.GITHUB_REF_TYPE || "";
  const refName = env.GITHUB_REF_NAME || "";
  const github = env.GITHUB_ACTIONS === "true" || Boolean(event || ref);

  if (!github) return { kind: "local" };

  if (event === "pull_request" || event === "pull_request_target") {
    if (env.GITHUB_BASE_REF !== "master")
      throw new Error("Pull request release checks require base branch master");
    return { kind: "pull-request", base: "master" };
  }

  if (event !== "push")
    throw new Error(
      `Unsupported GitHub release-check event: ${event || "unknown"}`,
    );

  if (refType === "tag" || ref.startsWith("refs/tags/")) {
    const tag = refName || ref.slice("refs/tags/".length);
    if (!directTag.test(tag))
      throw new Error(
        "Release tags must use direct vX.Y.Z format without an RC suffix",
      );
    if (tag !== `v${version}`)
      throw new Error(
        `Release tag ${tag} does not match product version ${version}`,
      );
    return { kind: "tag", tag };
  }

  const branch = refName || ref.replace(/^refs\/heads\//, "");
  if (
    refType !== "branch" ||
    ref !== "refs/heads/master" ||
    branch !== "master"
  )
    throw new Error("Branch push release checks require refs/heads/master");
  return { kind: "branch", branch };
}

export function validateTagProvenance({
  head,
  tagObject,
  tagTarget,
  remoteMaster,
}) {
  if (!tagObject || !tagTarget || tagObject === tagTarget)
    throw new Error("Release tag must be an annotated tag");
  if (head !== tagTarget)
    throw new Error(
      "Detached checkout HEAD does not match the release tag target",
    );
  if (tagTarget !== remoteMaster)
    throw new Error("Release tag target must equal origin/master HEAD");
}

const git = (cwd, ...args) =>
  execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

export function validateRepositoryRef({
  cwd = process.cwd(),
  env = process.env,
  version,
  allowLocalDetached = false,
  fetch = true,
} = {}) {
  const productVersion =
    version || JSON.parse(readFileSync(`${cwd}/package.json`, "utf8")).version;
  const policy = releaseRefPolicy(env, productVersion);
  const branch = git(cwd, "branch", "--show-current");

  if (policy.kind === "local") {
    if (branch !== "master" && !(allowLocalDetached && branch === ""))
      throw new Error("Expected master branch");
    return policy;
  }
  if (policy.kind !== "tag") return policy;

  if (fetch)
    execFileSync(
      "git",
      [
        "fetch",
        "--no-tags",
        "--prune",
        "origin",
        "+refs/heads/master:refs/remotes/origin/master",
      ],
      { cwd, stdio: "inherit" },
    );
  const remoteTagLines = git(
    cwd,
    "ls-remote",
    "origin",
    `refs/tags/${policy.tag}`,
    `refs/tags/${policy.tag}^{}`,
  )
    .split("\n")
    .filter(Boolean)
    .map((line) => line.split(/\s+/, 2));
  const remoteTag = new Map(remoteTagLines.map(([oid, ref]) => [ref, oid]));
  validateTagProvenance({
    head: git(cwd, "rev-parse", "HEAD"),
    tagObject: remoteTag.get(`refs/tags/${policy.tag}`),
    tagTarget: remoteTag.get(`refs/tags/${policy.tag}^{}`),
    remoteMaster: git(cwd, "rev-parse", "origin/master"),
  });
  return policy;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const policy = validateRepositoryRef();
  console.log(`Release ref policy: PASS (${policy.kind})`);
}
