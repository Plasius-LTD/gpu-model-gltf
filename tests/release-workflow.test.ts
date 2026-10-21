import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const workflow = readFileSync(
  new URL("../.github/workflows/release-prepare.yml", import.meta.url),
  "utf8",
);
const ciWorkflow = readFileSync(
  new URL("../.github/workflows/ci.yml", import.meta.url),
  "utf8",
);
const cdWorkflow = readFileSync(
  new URL("../.github/workflows/cd.yml", import.meta.url),
  "utf8",
);

describe("release preparation workflow", () => {
  it("does not let checkout credentials override the release-prep app token", () => {
    expect(workflow).toContain("persist-credentials: false");
  });

  it("retries a protected merge while required checks complete", () => {
    expect(workflow).toContain(
      'if gh pr merge "${PR_NUMBER}" --squash --delete-branch >/dev/null 2>&1; then',
    );
    expect(workflow).toContain("merged after required checks completed.");
  });

  it("runs trusted pull-request and exact-main validation on hosted runners", () => {
    expect(ciWorkflow).toContain("workflow_dispatch:");
    expect(ciWorkflow).toContain("pull_request:");
    expect(ciWorkflow).toContain("name: Trusted head admission");
    expect(ciWorkflow.match(/^ {4}runs-on: ubuntu-latest$/gmu)).toHaveLength(3);
    expect(ciWorkflow).not.toContain("self-hosted");
    expect(ciWorkflow).not.toMatch(/\n\s+cache:\s*["']?npm["']?/u);
    expect(ciWorkflow.match(/package-manager-cache: false/gu)).toHaveLength(2);
  });

  it("preserves the Schema release contract without a write-token fallback", () => {
    expect(cdWorkflow).toContain("Wait for successful exact-SHA main CI");
    expect(cdWorkflow).toContain(
      "node scripts/verify-public-package.cjs --inventory-stdin",
    );
    expect(cdWorkflow).toContain('npm publish "./${TARBALL}"');
    expect(cdWorkflow.match(/npm@11\.6\.2/gu)).toHaveLength(2);
    expect(cdWorkflow).toContain(
      "Revalidate exact main immediately before npm publication",
    );
    expect(cdWorkflow).not.toMatch(
      /bootstrap_first_publish|NPM_BOOTSTRAP_TOKEN|NPM_TOKEN|NODE_AUTH_TOKEN/u,
    );
  });

  it("runs Schema privacy and sealed-package checks in CI", () => {
    expect(ciWorkflow.indexOf("Verify private artifact policy")).toBeLessThan(
      ciWorkflow.indexOf("Install deps"),
    );
    expect(ciWorkflow).toContain("Test private artifact policy");
    expect(ciWorkflow).toContain("Verify public package contents");
  });
});

describe("interrupted publication version selection", () => {
  const start = workflow.indexOf('          if [ "${BUMP}" = "none" ]; then');
  const end = workflow.indexOf("            TARGET_VER=$(node -e", start);
  const selection =
    workflow.slice(start, end) +
    'TARGET_VER="fresh"\nfi\nprintf "SELECTED=%s\\n" "$TARGET_VER"';
  it.each([
    ["patch", "true", "draft", "fresh"],
    ["minor", "true", "missing", "fresh"],
    ["major", "true", "draft", "fresh"],
    ["patch", "true", "published", "fresh"],
    ["patch", "false", "published", "fresh"],
    ["patch", "false", "draft", "0.5.0"],
    ["minor", "false", "missing", "0.5.0"],
    ["none", "true", "draft", "0.5.0"],
    ["none", "false", "missing", "0.5.0"],
  ])(
    "%s with npm=%s and GitHub=%s selects %s",
    (bump, published, release, expected) => {
      expect(start).toBeGreaterThan(0);
      expect(end).toBeGreaterThan(start);
      const dir = mkdtempSync(join(tmpdir(), "gltf-release-selection-"));
      try {
        const file = join(dir, "CHANGELOG.md");
        writeFileSync(file, "## [Unreleased]\n\n## [0.5.0] - 2026-10-21\n");
        const result = spawnSync("bash", ["-e", "-c", selection], {
          encoding: "utf8",
          timeout: 2000,
          env: {
            ...process.env,
            BUMP: bump,
            CURRENT_VER: "0.5.0",
            CURRENT_PUBLISHED: published,
            CURRENT_RELEASE_STATE: release,
            FILE: file,
          },
        });
        expect(result.status, result.stderr).toBe(0);
        expect(result.stdout).toContain(`SELECTED=${expected}`);
      } finally {
        rmSync(dir, { recursive: true });
      }
    },
  );
});
