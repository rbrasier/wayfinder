# Wayfinder — Features

_Last updated: 5 June 2026_

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

### Flow Selector Search
When an organisation has many flows, the analytics dashboard's flow selector caps visible cards and reveals an auto-suggest search input. Flows are filtered by name as the user types, making it fast to navigate to the right flow regardless of how many exist.

_Why it matters:_ Without search, large flow lists become unmanageable in the analytics UI. Search keeps the dashboard usable as usage grows.

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

### Session Sharing (Read-only)
The session owner can copy a share link that renders the session in read-only mode for any authenticated user. Shared viewers see the full message history, step rail, and confidence bars but cannot send messages.

_Why it matters:_ Clients, reviewers, and managers often need visibility into a process without participating. Read-only sharing provides that without granting edit access.

### Branch-Aware Context
When a flow has multiple outgoing edges from a step (a branching node), a separate AI call selects which branch to take. The branch-choice prompt includes each candidate step's purpose (its completion criteria and instructions) and requests a written rationale before committing to a branch. This gives the model the context it needs to make correct branching decisions.

_Why it matters:_ Without branch context the model must infer the meaning of each path from its name alone, which produces unreliable routing. Richer context significantly improves decision quality and produces an auditable rationale.

### AI Transparency Modals
Users can open a transparency modal on any AI message to see the model's reasoning, which information sources were used, and the exact confidence score that was returned. The modal presents this in plain language, not raw JSON.

_Why it matters:_ Users working on high-stakes documents (contracts, regulatory assessments) need to understand and trust why the AI said what it said. Transparency modals surface that reasoning without cluttering the main chat view.

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
Templates are validated at upload time: files must not exceed the configured content size limit, and every `{{ tag }}` must be syntactically valid. Uploads that contain untagged content where tags are expected, or tags with invalid annotations, are rejected with a specific error message explaining what to fix.

_Why it matters:_ A malformed template produces a broken document or a silent generation failure. Catching errors at upload time, before any sessions run, saves flow authors from diagnosing mysterious generation failures.

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

### Scheduler Auto-Resume
If a scheduled session is interrupted — due to a worker restart, deployment, or transient error — it automatically resumes from its last LangGraph checkpoint when the worker comes back online. No session is silently lost or left in a half-complete state.

_Why it matters:_ Reliability is a prerequisite for unattended automation. Without auto-resume a failed worker process would leave scheduled sessions permanently stalled, requiring manual diagnosis and restarting.

### Plain-Language Schedule UX
Schedule recurrence is configured using a plain-language input (e.g. "every weekday at 9 AM", "first Monday of the month") rather than raw cron syntax. The UI shows a human-readable confirmation of the next scheduled run time.

_Why it matters:_ Cron syntax is error-prone for non-technical users. A plain-language interface reduces misconfiguration and makes schedules auditable at a glance.

---

## Analytics & Observability

### Overview Dashboard
An admin dashboard shows organisation-wide session metrics: active sessions, total completions, completion rate, period-on-period deltas, a daily started-vs-completed dual-line chart, flow distribution by session count, and an AI confidence trend across session lifetime.

_Why it matters:_ Without aggregate visibility, admins have no way to know whether flows are working or where users are dropping off. The overview dashboard turns raw session data into actionable operational insight.

### Flow Insights Dashboard
A per-flow analytics view shows step-by-step drop-off rates, average AI confidence per step, a node breakdown table with completion colour coding, and a template field reporting section that aggregates the values actually inserted into generated documents.

_Why it matters:_ The overview tells you something is wrong; the flow insights tell you where and why. Step-level drop-off identifies which nodes cause users to abandon, and field-level reporting lets compliance officers verify that documents contain the expected data.

### Langfuse Integration
Langfuse tracing is available as an opt-in integration. When configured, every LLM call — text stream, object generation, branch choice — produces a trace in Langfuse with latency, token counts, model ID, and the full prompt/response payload.

_Why it matters:_ LLM costs and latency are opaque without instrumentation. Langfuse traces make it possible to optimise prompts, identify slow steps, and attribute token spend to specific flows and steps.

---

## Authentication & AI Providers

### Magic Link Authentication
Users log in via a passwordless email magic link. The admin seed email is automatically promoted to admin on first login. No password management is required.

_Why it matters:_ Magic links eliminate password reuse, credential theft, and password-reset flows. For internal tools where email is already the identity source of truth, they provide secure login with minimal friction.

### Username/Password Authentication
Traditional username and password login is available alongside magic links for deployments that require it — for example, environments where users do not have reliable email access or where a local identity store is preferred.

_Why it matters:_ Some enterprise environments have restrictions on email-based authentication, or existing tooling that expects credential-based login. Offering both methods ensures Wayfinder can be deployed in a wider range of organisational contexts.

### Multi-Provider AI
The AI provider, model ID, and API key are all configurable via environment variables. Supported providers are Anthropic, OpenAI, Mistral, and AWS Bedrock. Different steps in a flow can use different models; the embedding provider is configured independently of the chat provider.

_Why it matters:_ AI model choice is a commercial, regulatory, and performance decision that varies by organisation and jurisdiction. Treating the provider as configuration rather than a hard dependency means Wayfinder can operate in AWS GovCloud, European data-residency environments, or wherever the organisation's AI procurement has landed.
