import { describe, expect, it } from "bun:test";

import {
  DEFAULT_ACCESS_TYPE,
  DEFAULT_TEMPORARY_DAYS,
  canCancelShareRequest,
  getAvailableAccessTypes,
  resolveRecipients,
  validateAccessTypeSelection,
} from "../../../web/src/components/meetingSharing.logic";

const alice = { email: "alice@example.com", granteeUserId: "user-alice" };
const bob = { email: "bob@example.com", granteeUserId: null };
const carol = { email: "carol@example.com", granteeUserId: null };

describe("meetingSharing.logic defaults", () => {
  it("defaults access type to permanent (spec: permanent is default for participants)", () => {
    expect(DEFAULT_ACCESS_TYPE).toBe("permanent");
  });

  it("pre-fills the temporary day count with 15 (spec: temporary day count is editable, not fixed)", () => {
    expect(DEFAULT_TEMPORARY_DAYS).toBe(15);
  });
});

describe("resolveRecipients — recipient-selection modes", () => {
  it("mode 'all' expands to every participant, one row per recipient", () => {
    const recipients = resolveRecipients({
      mode: "all",
      participants: [alice, bob, carol],
      selectedEmails: [],
      manualRecipient: null,
    });
    expect(recipients).toEqual([alice, bob, carol]);
  });

  it("mode 'subset' only includes the selected participants (unselected get nothing)", () => {
    const recipients = resolveRecipients({
      mode: "subset",
      participants: [alice, bob, carol],
      selectedEmails: [bob.email],
      manualRecipient: null,
    });
    expect(recipients).toEqual([bob]);
  });

  it("mode 'email' resolves to the single manually-resolved recipient", () => {
    const manual = { email: "guest@example.com", granteeUserId: null };
    const recipients = resolveRecipients({
      mode: "email",
      participants: [alice, bob],
      selectedEmails: [],
      manualRecipient: manual,
    });
    expect(recipients).toEqual([manual]);
  });

  it("mode 'email' with no manual recipient yet resolves to an empty batch", () => {
    const recipients = resolveRecipients({
      mode: "email",
      participants: [],
      selectedEmails: [],
      manualRecipient: null,
    });
    expect(recipients).toEqual([]);
  });
});

describe("getAvailableAccessTypes — single_use only for unregistered recipients", () => {
  it("offers single_use when every recipient in the batch is unregistered", () => {
    expect(getAvailableAccessTypes([bob, carol])).toEqual(["single_use", "temporary", "permanent"]);
  });

  it("excludes single_use when any recipient in the batch is registered", () => {
    expect(getAvailableAccessTypes([alice, bob])).toEqual(["temporary", "permanent"]);
  });

  it("excludes single_use for an empty batch", () => {
    expect(getAvailableAccessTypes([])).toEqual(["temporary", "permanent"]);
  });
});

describe("validateAccessTypeSelection", () => {
  it("rejects an empty recipient batch", () => {
    expect(
      validateAccessTypeSelection({ accessType: "permanent", recipients: [], expiresInDays: null })
    ).not.toBeNull();
  });

  it("rejects single_use when any selected recipient is registered", () => {
    expect(
      validateAccessTypeSelection({ accessType: "single_use", recipients: [alice], expiresInDays: null })
    ).not.toBeNull();
  });

  it("accepts single_use when every recipient is unregistered", () => {
    expect(
      validateAccessTypeSelection({ accessType: "single_use", recipients: [bob], expiresInDays: null })
    ).toBeNull();
  });

  it("rejects temporary without a positive day count", () => {
    expect(
      validateAccessTypeSelection({ accessType: "temporary", recipients: [alice], expiresInDays: null })
    ).not.toBeNull();
    expect(
      validateAccessTypeSelection({ accessType: "temporary", recipients: [alice], expiresInDays: 0 })
    ).not.toBeNull();
  });

  it("accepts temporary with a valid day count, any value (not just the fixed TTL menu)", () => {
    expect(
      validateAccessTypeSelection({ accessType: "temporary", recipients: [alice], expiresInDays: 123 })
    ).toBeNull();
  });

  it("accepts permanent unconditionally", () => {
    expect(
      validateAccessTypeSelection({ accessType: "permanent", recipients: [alice, bob], expiresInDays: null })
    ).toBeNull();
  });
});

describe("canCancelShareRequest — only the author may cancel their own pending request", () => {
  it("allows the requester to cancel their own pending request", () => {
    expect(canCancelShareRequest({ status: "pending", requesterId: "member-1" }, "member-1")).toBe(true);
  });

  it("rejects another member (or admin) cancelling someone else's request", () => {
    expect(canCancelShareRequest({ status: "pending", requesterId: "member-1" }, "member-2")).toBe(false);
    expect(canCancelShareRequest({ status: "pending", requesterId: "member-1" }, "admin-1")).toBe(false);
  });

  it("rejects cancelling a request that already left the pending state", () => {
    expect(canCancelShareRequest({ status: "approved", requesterId: "member-1" }, "member-1")).toBe(false);
    expect(canCancelShareRequest({ status: "rejected", requesterId: "member-1" }, "member-1")).toBe(false);
    expect(canCancelShareRequest({ status: "cancelled", requesterId: "member-1" }, "member-1")).toBe(false);
  });

  it("rejects when no caller is known (unauthenticated on client)", () => {
    expect(canCancelShareRequest({ status: "pending", requesterId: "member-1" }, undefined)).toBe(false);
  });
});
