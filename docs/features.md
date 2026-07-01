# Wayfinder — Features

_Last updated: 1 July 2026_

This document provides a detailed breakdown of Wayfinder's features, organised by capability area. For a high-level summary see the [README](../README.md).

---

## Workflow Design

### Visual Canvas Builder
Admins design workflows on a drag-and-drop node canvas powered by React Flow. Each node represents a step in the process; edges define the order and branching paths. Nodes are configured with AI instructions, completion criteria, colour, and output type. The canvas persists all changes to the database so a flow can be built incrementally across sessions.

_Why it matters:_ Complex document-heavy processes often involve many conditional paths and subject-matter experts who aren't developers. A visual canvas lets a flow owner model the exact process without writing code.

### Flow Visibility Control
Flows can be set to **private** (accessible only to the flow owner) or **global** (accessible to all authenticated users). Admins control this from the flow listing page. Users only see published, globally-visible flows in the New Chat modal.

_Why it matters:_ Organisations need to test and iterate on flows before rolling them out. Private visibility lets a flow owner iterate without exposing an incomplete workflow to end users.

### Step Prompt Preview
Before publishing, a flow owner can preview the exact AI prompt that will be generated for each step, including injected context. This lets authors verify the prompt reads as intended and catches configuration mistakes before users encounter them.

_Why it matters:_ AI prompts are sensitive to wording. Seeing the final rendered prompt removes uncertainty and dramatically reduces the feedback loop during flow authoring.

### Flow Versioning
Publishing a flow snapshots it as an immutable, numbered version. Sessions are pinned to the version that was live when they started, so editing or restoring a flow never changes an in-progress chat. Admins can inspect the full version history and non-destructively restore an earlier version, which itself publishes as a new version.

_Why it matters:_ Flow owners need to keep iterating on a live process without breaking the chats already running on it. Immutable, pinned versions make editing safe and give admins an audit trail of what changed and when.

### Step Completion Confirmation
Flow authors can require a step to pause for explicit operator confirmation once the AI considers it complete, instead of auto-advancing. The user keeps chatting while a "Proceed" prompt waits in the footer, giving them a moment to review before the step hands over.

_Why it matters:_ Some steps carry consequences a user should consciously confirm — sign-off style moments where silent auto-advance feels wrong. A per-node toggle lets authors choose the right handover behaviour per step.

---

## Conversational AI Sessions

### Chat Interface
Users start sessions on published flows from a dedicated chat screen. Each session is a streaming, multi-turn conversation powered by a LangGraph state machine compiled from the flow's node graph. The AI gathers information step-by-step, signals its confidence after each reply, and advances to the next step automatically when confidence reaches the threshold.

_Why it matters:_ Traditional forms are static and can't adapt to what a user has already said. A conversational interface lets the AI ask intelligent follow-up questions, catch ambiguities, and guide users naturally through a complex process.

### Structured AI Turns
Each AI reply is generated as both a streaming text response (for immediate display) and a structured confidence assessment (via parallel `streamObject`). The confidence score and a `readyToAdvance` flag determine whether the step is complete. This separation keeps the conversational reply natural while giving the system a reliable signal for step progression.

_Why it matters:_ Without a structured confidence signal the system would need heuristics to decide when to move on, which is fragile. A scored, structured response makes step advancement deterministic and auditable.

### Real-time Collaborative Sessions
Multiple authenticated users can participate in the same session simultaneously via a shared link. All participants can send messages; new messages and AI replies propagate to every open window within a few seconds. A typing indicator shows when another participant is composing a message.

_Why it matters:_ Many document-heavy processes involve more than one stakeholder. Collaboration lets a subject-matter expert and a document author work through a session together without one person relaying questions to the other.

### Branch-Aware Context
When a flow has multiple outgoing edges from a step (a branching node), a separate AI call selects which branch to take. The branch-choice prompt includes each candidate step's purpose (its completion criteria and instructions) and requests a written rationale before committing to a branch. This gives the model the context it needs to make correct branching decisions.

_Why it matters:_ Without branch context the model must infer the meaning of each path from its name alone, which produces unreliable routing. Richer context significantly improves decision quality and produces an auditable rationale.

### AI Transparency Modals
Users can open a transparency modal on any AI message to see the model's reasoning, which information sources were used, and the exact confidence score that was returned. The modal presents this in plain language, not raw JSON.

_Why it matters:_ Users working on high-stakes documents (contracts, regulatory assessments) need to understand and trust why the AI said what it said. Transparency modals surface that reasoning without cluttering the main chat view.

### Auto-Send Kickoff Message
A freshly created session automatically sends an opening, user-authored message referencing the flow (and its first step, where known) so the AI responds immediately instead of leaving the user on an empty thread.

_Why it matters:_ A blank chat window is an unnecessary hesitation point. Starting the conversation on the user's behalf gets them into the flow with zero friction.

### Grouped Follow-up Questions
The AI can batch closely related follow-up questions into a single message when it's natural to do so, rather than being constrained to ask strictly one question at a time.

_Why it matters:_ Some steps naturally need a few closely related pieces of information (name, date, amount) that a person would ask for together. Allowing grouped questions keeps the conversation feeling natural instead of needlessly slow.

---

## Document Generation

### DOCX Document Generation
Flow steps configured with output type `generate_document` automatically fill a Word document template with information gathered during the conversation. The filled document is stored in object storage (MinIO or S3) and presented to the user as a downloadable card in the chat.

_Why it matters:_ The end goal of most document-heavy processes is a finished document. Automatic generation eliminates the manual step of copying answers from a form into a Word template, which is error-prone and time-consuming.

### Template Field Annotations
Template `{{ tags }}` support inline type annotations — `(date)`, `(currency)`, `(email)`, `(yesno)`, `(options: A, B, C)`, `(maxlen: 200)`, and so on. The annotation is parsed at upload time, stored in the node configuration, and injected into the AI's system prompt so it reformats user input to the required type before inserting it into the document.

_Why it matters:_ Without type constraints the AI inserts whatever the user said verbatim, producing inconsistent date formats, un-formatted currency values, and freeform text where a yes/no was expected. Annotations enforce correctness at the source.

### Narrative & Optional Sections
Flow steps can produce free-form narrative text in addition to tagged fields. Sections of a template can also be marked as optional and will only be included in the generated document when the conversation outcome warrants it.

_Why it matters:_ Real documents often contain sections that summarise context in prose or that only apply in certain cases. Without narrative and optional section support every document is either identical in structure or requires a different template per path.

### Context Document Extraction
PDF, DOCX, and XLSX files uploaded as flow-level context documents are parsed and their content is injected into the AI's background knowledge for every session on that flow. This allows flows to be grounded in reference material such as policies, contracts, or product specifications.

_Why it matters:_ AI models have a training cutoff and no access to internal documents. Injecting extracted content bridges that gap, allowing the AI to answer domain-specific questions accurately without fine-tuning.

### Template Validation
Uploaded `.docx` templates are validated at upload time; files with malformed tags or invalid type annotations are rejected immediately with a clear error message rather than failing silently during a live session.

_Why it matters:_ A broken template that only fails mid-session ruins a user's progress and is hard to diagnose. Validating at upload time catches authoring mistakes before they can affect anyone.

### Manual Document Field Editing
After a document is generated, an operator can open a typed edit form and correct individual field values. Saving re-renders the DOCX to a new version, updates the step output the rest of the flow reads from, and appends the change to a durable, auditable edit history without re-running AI grading.

_Why it matters:_ AI extraction is not infallible, and re-running an entire conversation to fix one wrong value is wasteful. Direct field correction gives operators a fast, audited way to get the document right.

### Pre-Generation Evaluation Gate
For `generate_document` steps, the high-quality document-generation model extracts and grades the template fields *before* the step advances, not just afterwards as an audit step. If the grade falls short of the node's confidence threshold the step holds and the AI immediately asks a targeted follow-up about what's missing; a passing grade is reused for generation, so a pass costs no extra AI calls versus the old post-hoc check.

_Why it matters:_ Grading after the fact catches a bad document only once it already exists. Gating on the same evaluation before advancing stops incomplete or low-confidence documents from being generated at all.

### Configurable Document Generation Budgets
The safety limits that bound document generation — context-document token budget, field batch size, and max prompt tokens — are admin-configurable from **Configuration → AI → Document Generation** instead of hardcoded, and apply on the next request with no redeploy. The context budget can be set as an explicit token cap or as a percentage of the configured model's context window.

_Why it matters:_ The right generation limits depend on the model in use and the size of an organisation's documents. Making them configuration rather than code lets admins tune for their own templates without a release.

---

## Step Approvals

### Approval Workflow Node
A flow can include an `approval` node that pauses a session until a confirmed human approver decides to approve, reject, or request changes. A suggested approver is proposed automatically (by reporting line, role, or policy) but the operator always confirms or overrides the choice through a federated people search before the request is sent.

_Why it matters:_ Some processes legally or organisationally require a human sign-off. A first-class approval node brings that gate into the flow itself instead of requiring a manual, out-of-band step.

### Federated Approver Resolution
Approver suggestions are resolved across multiple sources — Microsoft Entra directory data, an uploaded HR spreadsheet (with AI-assisted column mapping), or a retrieval-augmented lookup over the flow's own reference material — with a free-typed email always available as a fallback.

_Why it matters:_ Organisations keep reporting-line data in different systems, and no single source is complete. Federating sources means an approver can nearly always be resolved automatically, with a manual escape hatch when it can't.

### Approval Context & Decision UX
The `/approvals` inbox shows the approver exactly what they're deciding on — the requesting chat, who it's from, and the actual output (document or field table) from the step being approved. Approve, reject, and request-changes decisions are captured through a comment modal, are written back into the chat as a system message, and a "request changes" decision automatically routes the session back to the prior step for the user to address.

_Why it matters:_ Approving something without seeing what it's approving isn't a real review. Full context plus a visible decision trail makes the approval gate meaningful and auditable.

---

## Knowledge Base & RAG

### RAG with pgvector
Documents uploaded to the knowledge base are chunked, embedded, and stored in PostgreSQL using the pgvector extension. During a session the AI performs semantic similarity search over the embedded chunks to retrieve the most relevant passages and inject them into the prompt.

_Why it matters:_ Context document extraction works well for small, focused reference files. For large corpora — product manuals, legal libraries, regulatory archives — full-text injection exceeds the model's context window. RAG retrieves only what's relevant, keeping the prompt focused and costs manageable.

### Configurable Embeddings
The embedding model, provider, and vector dimensions are configurable per deployment via environment variables. A reindex-all command re-embeds every document in the knowledge base, making it straightforward to migrate to a better embedding model without losing existing content.

_Why it matters:_ Embedding models improve rapidly and the right model differs by domain. Treating the embedding provider as a configuration concern rather than a code constant lets organisations upgrade without a code change.

### Session File Upload
Users can upload files during a live session. Uploaded files are processed immediately and added to the AI's context for that session, allowing users to supply supporting documents on the fly rather than requiring flow owners to pre-load all possible reference material.

_Why it matters:_ Pre-loading all relevant reference material into a flow is not always practical. Session-time uploads let users bring in the specific document that's relevant to their situation — a contract draft, a scanned form, a report — at the moment it's needed.

### Knowledge Base Curation
Subject-matter experts get a dedicated curation grid to search, edit, tag, and bulk archive or restore knowledge base chunks, with full version history and one-click revert. Any user can flag an AI answer with "Fix This Answer" and submit a correction; SMEs triage submitted corrections from the same screen. Edited chunks are automatically re-embedded, and retrieval combines Postgres full-text search with pgvector similarity for more reliable matches.

_Why it matters:_ RAG is only as good as the content it retrieves, and bad chunks are hard to spot from the chat alone. Giving SMEs a governed way to see, correct, and improve what the AI retrieves closes the loop between "the AI got it wrong" and "the knowledge base is fixed."

### View Knowledge from Flow Editor
A "View knowledge" button in the flow editor's context-documents panel opens the curation grid pre-filtered to that flow's knowledge base.

_Why it matters:_ A flow owner shouldn't have to navigate away and re-select their flow to check what the AI actually knows. A direct link keeps authoring and knowledge review in the same workflow.

---

## Automation & External Integrations

### n8n Automation Integration
Flow steps can be configured as "auto-nodes" that trigger an n8n workflow instead of prompting a human. Session context is serialised as structured JSON and posted to n8n; the flow pauses and resumes automatically when n8n calls back with its result.

_Why it matters:_ Not every step in a workflow requires human input. Auto-nodes allow external systems — CRMs, approval systems, databases, notification services — to participate in a flow without manual intervention, turning Wayfinder into an orchestration layer rather than just a chat tool.

### n8n Workflow Context Mapping
Outputs returned by an n8n workflow are mapped back into the session context using a configurable field mapping. Downstream steps can reference the n8n output fields as if they had been gathered through conversation.

_Why it matters:_ Without context mapping, n8n outputs are opaque to the AI. Explicit field mapping makes automation outputs first-class session data, so the AI can reference, summarise, and build on them in subsequent steps.

### Scheduled Sessions
Flows can be configured to start sessions automatically on a cron schedule or fixed interval. Scheduled sessions run unattended via the background worker and proceed through all auto-nodes without human input.

_Why it matters:_ Many compliance and reporting processes must run at specific times — end of day, end of month, on a trigger date. Scheduling lets these flows run reliably without requiring a human to manually initiate them.

### Plain-Language Schedule UX
Schedule recurrence is configured using a plain-language input (e.g. "every weekday at 9 AM", "first Monday of the month") rather than raw cron syntax. The UI shows a human-readable confirmation of the next scheduled run time.

_Why it matters:_ Cron syntax is error-prone for non-technical users. A plain-language interface reduces misconfiguration and makes schedules auditable at a glance.

### Microsoft 365 Email Provider
Admins can configure Microsoft 365/Exchange as the outbound email provider for notifications, alongside SMTP, and control which events (session complete, flow shared) trigger an email.

_Why it matters:_ Many organisations already run Microsoft 365 and would rather use it directly than stand up a separate SMTP relay for one application.

---

## Analytics & Observability

### Overview Dashboard
An admin dashboard shows organisation-wide session metrics: active sessions, total completions, completion rate, period-on-period deltas, a daily started-vs-completed dual-line chart, flow distribution by session count, and an AI confidence trend across session lifetime.

_Why it matters:_ Without aggregate visibility, admins have no way to know whether flows are working or where users are dropping off. The overview dashboard turns raw session data into actionable operational insight.

### Flow Usage & Insights Dashboards
A per-flow analytics view is split across two pages: **Flow usage** shows step-by-step drop-off rates, average AI confidence per step, and a node breakdown table with completion colour coding, while **Insights** hosts template field reporting, aggregating the values actually inserted into generated documents. Same-meaning columns from mutually-exclusive branches or across flow versions are automatically consolidated (togglable) so the report reads as one field, not several duplicates.

_Why it matters:_ The overview tells you something is wrong; flow usage and insights tell you where and why. Step-level drop-off identifies which nodes cause users to abandon, field-level reporting lets compliance officers verify that documents contain the expected data, and consolidation stops a flow's evolution from fragmenting that report into noise.

### Langfuse Integration
Langfuse tracing is available as an opt-in integration. When configured, every LLM call — text stream, object generation, branch choice — produces a trace in Langfuse with latency, token counts, model ID, and the full prompt/response payload.

_Why it matters:_ LLM costs and latency are opaque without instrumentation. Langfuse traces make it possible to optimise prompts, identify slow steps, and attribute token spend to specific flows and steps.

### Cost & Usage Governance Dashboard
Admins can set per-user spend caps (daily, weekly, or monthly USD limits, off by default) with a configurable warn threshold; once a cap is reached, further AI calls are blocked with a clear in-chat message rather than failing silently, and every warn or block is audited. A governance dashboard shows total spend, spend by user and by flow, and each cap's current utilisation; cap management is also available from the existing Usage screen.

_Why it matters:_ Uncontrolled AI spend is a real operational risk once a flow is used widely. Per-user caps with a warning stage give admins a hard backstop without surprising users mid-session.

---

## Access Control & Administration

### Microsoft Entra ID Login
Admins can enable Microsoft Entra ID as a sign-in method alongside email and password, entering the app-registration credentials directly in the admin UI with changes taking effect immediately, no redeploy required. The "Sign in with Microsoft" button only appears once Entra is fully configured, and first-time Entra sign-in auto-provisions a non-admin account (linking to an existing user by verified email where one exists).

_Why it matters:_ Many organisations require SSO through their existing identity provider. Configuring it at runtime, rather than through environment variables and a deploy, keeps identity setup in the hands of the admin who owns it.

### Custom Roles & Feature Access
Admins can create custom roles beyond the built-in set, rename non-immutable roles, and control access to individual features through a feature-access matrix on the Roles page, rather than every permission being hardcoded to a fixed role.

_Why it matters:_ Organisations don't all draw admin boundaries the same way. Custom roles let an organisation delegate exactly the capabilities a given team needs, without over- or under-provisioning access.

### On-Demand Connectivity Testing
Each external integration configured on the admin Settings page (AI provider, object storage, email, n8n, embeddings, Entra) gets a "Test connectivity" button that runs a live, read-only probe against the saved credentials, plus a "Test all" button that runs every applicable probe in parallel.

_Why it matters:_ A saved API key or connection string isn't proof it works. On-demand testing gives an admin immediate confidence that an integration is actually reachable, without waiting for it to fail in front of a user.

---

## AI Providers

### Multi-Provider AI
The AI provider, model ID, and API key are all configurable via environment variables. Supported providers are Anthropic, OpenAI, Mistral, and AWS Bedrock. Different steps in a flow can use different models; the embedding provider is configured independently of the chat provider.

_Why it matters:_ AI model choice is a commercial, regulatory, and performance decision that varies by organisation and jurisdiction. Treating the provider as configuration rather than a hard dependency means Wayfinder can operate in AWS GovCloud, European data-residency environments, or wherever the organisation's AI procurement has landed.

---

## Accessibility

### WCAG 2.2 AA Compliance
The web app is built and continuously checked against WCAG 2.2 AA — colour contrast, keyboard navigation, focus management, and labelling are enforced as part of `validate.sh` and covered by a dedicated Playwright accessibility suite, not left to manual spot-checks.

_Why it matters:_ Document-heavy, process-driven tools are often used by people who rely on assistive technology, and many organisations require WCAG AA compliance as a procurement condition. Enforcing it continuously keeps regressions from shipping unnoticed.
