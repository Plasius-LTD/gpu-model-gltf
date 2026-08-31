import { readFileSync } from "node:fs";

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
    expect(workflow).toContain(
      "merged after required checks completed.",
    );
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
    expect(cdWorkflow).toContain("Revalidate exact main immediately before npm publication");
    expect(cdWorkflow).not.toMatch(/bootstrap_first_publish|NPM_BOOTSTRAP_TOKEN|NPM_TOKEN|NODE_AUTH_TOKEN/u);
  });

  it("runs Schema privacy and sealed-package checks in CI", () => {
    expect(ciWorkflow.indexOf("Verify private artifact policy")).toBeLessThan(
      ciWorkflow.indexOf("Install deps"),
    );
    expect(ciWorkflow).toContain("Test private artifact policy");
    expect(ciWorkflow).toContain("Verify public package contents");
  });
});
