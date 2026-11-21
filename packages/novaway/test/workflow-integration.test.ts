import { describe, expect, test } from "bun:test"
import { createHmac } from "node:crypto"
import { githubEvent, hasGithubDelivery, verifyGithubSignature } from "../src/workflow/integration"
describe("GitHub workflow integration", () => {
  test("maps push to commit", () =>
    expect(
      githubEvent({
        event: "push",
        payload: { ref: "refs/heads/main", after: "abc", repository: { full_name: "org/repo" } },
      }).kind,
    ).toBe("commit"))
  test("maps pull request with head sha", () =>
    expect(
      githubEvent({
        event: "pull_request",
        payload: {
          number: 4,
          action: "closed",
          pull_request: { head: { sha: "def" }, html_url: "https://github.com/x/y/pull/4" },
        },
      }).payload.sha,
    ).toBe("def"))
  test("maps GitHub Actions workflow runs to check integrations", () => {
    const result = githubEvent({
      event: "workflow_run",
      deliveryID: "actions-delivery-1",
      payload: {
        action: "completed",
        workflow_run: {
          name: "CI",
          head_sha: "fed",
          conclusion: "success",
        },
      },
    })
    expect(result.kind).toBe("check")
    expect(result.payload).toMatchObject({
      provider: "github",
      event: "workflow_run",
      deliveryID: "actions-delivery-1",
      name: "CI",
      sha: "fed",
      conclusion: "success",
    })
  })
  test("normalizes a delivery id without persisting undefined fields", () => {
    const result = githubEvent({ event: "push", deliveryID: "  delivery-1  ", payload: { ref: "main", after: "abc" } })
    expect(result.payload.deliveryID).toBe("delivery-1")
    expect(Object.hasOwn(result.payload, "repository")).toBe(true)
  })
  test("recognizes a previously persisted GitHub delivery", () => {
    expect(
      hasGithubDelivery(
        [
          { type: "memory.evidence", payload: { deliveryID: "delivery-1" } },
          { type: "integration.commit", payload: { deliveryID: "delivery-1" } },
        ],
        "delivery-1",
      ),
    ).toBe(true)
    expect(
      hasGithubDelivery([{ type: "integration.commit", payload: { deliveryID: "delivery-2" } }], "delivery-1"),
    ).toBe(false)
  })
  test("verifies GitHub's raw-body HMAC signature and rejects tampering", () => {
    const secret = "webhook-secret"
    const rawBody = '{"action":"completed","check_run":{"name":"ci"}}'
    const signature = `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`
    expect(verifyGithubSignature({ rawBody, signature, secret })).toBe(true)
    expect(verifyGithubSignature({ rawBody: `${rawBody} `, signature, secret })).toBe(false)
    expect(verifyGithubSignature({ rawBody, signature: "sha256=not-a-digest", secret })).toBe(false)
  })
})
