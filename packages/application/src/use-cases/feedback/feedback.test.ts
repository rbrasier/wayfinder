import {
  domainError,
  err,
  ok,
  type AnswerFeedback,
  type IAnswerFeedbackRepository,
  type NewAnswerFeedback,
} from "@rbrasier/domain";
import { describe, expect, it, vi } from "vitest";
import { ListAnswerFeedback } from "./list-answer-feedback";
import { SubmitAnswerFeedback } from "./submit-answer-feedback";
import { TriageAnswerFeedback } from "./triage-answer-feedback";

const submission: NewAnswerFeedback = {
  sessionId: "session-1",
  messageId: "message-1",
  flaggedAnswer: "The lead time is 6 weeks.",
  correctedText: "The lead time is 3 weeks.",
  reason: "outdated",
  createdBy: "user-1",
};

const stored: AnswerFeedback = {
  id: "feedback-1",
  ...submission,
  status: "pending",
  createdAt: new Date(),
  updatedAt: new Date(),
};

const repositoryWith = (overrides: Partial<IAnswerFeedbackRepository>): IAnswerFeedbackRepository =>
  ({
    create: vi.fn(),
    list: vi.fn(),
    setStatus: vi.fn(),
    ...overrides,
  }) as unknown as IAnswerFeedbackRepository;

describe("SubmitAnswerFeedback", () => {
  it("persists the correction through the repository", async () => {
    const create = vi.fn().mockResolvedValue(ok(stored));
    const repository = repositoryWith({ create });

    const result = await new SubmitAnswerFeedback(repository).execute(submission);

    expect(create).toHaveBeenCalledWith(submission);
    expect(result.error).toBeUndefined();
    expect(result.data).toEqual(stored);
  });

  it("surfaces a repository failure", async () => {
    const create = vi.fn().mockResolvedValue(err(domainError("INFRA_FAILURE", "down")));
    const repository = repositoryWith({ create });

    const result = await new SubmitAnswerFeedback(repository).execute(submission);

    expect(result.data).toBeUndefined();
    expect(result.error?.code).toBe("INFRA_FAILURE");
  });
});

describe("ListAnswerFeedback", () => {
  it("passes the filter through to the repository", async () => {
    const list = vi.fn().mockResolvedValue(ok([stored]));
    const repository = repositoryWith({ list });
    const filter = { status: "pending" as const, limit: 50, offset: 0 };

    const result = await new ListAnswerFeedback(repository).execute(filter);

    expect(list).toHaveBeenCalledWith(filter);
    expect(result.data).toEqual([stored]);
  });
});

describe("TriageAnswerFeedback", () => {
  it("moves the submission to the chosen terminal status", async () => {
    const setStatus = vi.fn().mockResolvedValue(ok({ ...stored, status: "accepted" }));
    const repository = repositoryWith({ setStatus });

    const result = await new TriageAnswerFeedback(repository).execute({
      feedbackId: "feedback-1",
      status: "accepted",
    });

    expect(setStatus).toHaveBeenCalledWith("feedback-1", "accepted");
    expect(result.data?.status).toBe("accepted");
  });
});
