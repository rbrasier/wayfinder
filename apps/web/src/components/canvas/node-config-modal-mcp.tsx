"use client";

import type {
  FieldValueSource,
  McpServerWithTools,
  PriorStepField,
  TemplateField,
} from "@wayfinder/domain";
import { FieldGroupLabel } from "@/components/ui/field-group-label";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { TemplateFieldEditor } from "./template-field-editor";
import { FieldValueList } from "./field-value-selector";
import {
  describeInputSchemaParameters,
  requestFieldLinesFromInputSchema,
} from "./request-fields-from-input-schema";
import type { NodeConfigValues } from "./node-config-modal";

const SELECT_CLASS =
  "flex h-10 w-full rounded-[9px] border border-[#e7e3db] bg-[#faf9f7] px-3 py-2 text-[13px] text-[#1c1b19] focus:border-[#1f6b4d] focus:bg-white focus:outline-hidden";

// The MCP-step section of NodeConfigModal. The parent owns all state; this is a
// presentation view over `values` + `set` plus the fetched server/tool list.
export interface NodeConfigModalMcpProps {
  values: NodeConfigValues;
  set: <K extends keyof NodeConfigValues>(key: K, value: NodeConfigValues[K]) => void;
  priorStepFields: PriorStepField[];
  mcpServers: McpServerWithTools[];
  selectedMcpServer: McpServerWithTools | null;
  mcpServersLoading: boolean;
  requestLines: string[];
  setRequestLines: (lines: string[]) => void;
  responseLines: string[];
  setResponseLines: (lines: string[]) => void;
  requestFields: TemplateField[];
  setFieldValue: (key: string, next: FieldValueSource) => void;
}

export function NodeConfigModalMcp({
  values,
  set,
  priorStepFields,
  mcpServers,
  selectedMcpServer,
  mcpServersLoading,
  requestLines,
  setRequestLines,
  responseLines,
  setResponseLines,
  requestFields,
  setFieldValue,
}: NodeConfigModalMcpProps) {
  const selectedTool = selectedMcpServer?.tools.find((tool) => tool.name === values.mcpToolName) ?? null;
  const parameters = describeInputSchemaParameters(selectedTool?.inputSchema ?? null);

  // Starting from the tool's real arguments; a node whose author already wrote
  // request fields keeps them.
  const chooseTool = (toolName: string) => {
    set("mcpToolName", toolName);
    const tool = selectedMcpServer?.tools.find((entry) => entry.name === toolName);
    const hasRequestFields = requestLines.some((line) => line.trim().length > 0);
    if (tool && !hasRequestFields) setRequestLines(requestFieldLinesFromInputSchema(tool.inputSchema));
  };

  return (
    <>
      <div className="space-y-1">
        <Label htmlFor="mcp-server">MCP server</Label>
        <select
          id="mcp-server"
          className={SELECT_CLASS}
          value={values.mcpServerId}
          onChange={(e) => {
            set("mcpServerId", e.target.value);
            set("mcpToolName", "");
          }}
        >
          <option value="">Select a server…</option>
          {mcpServers.map((entry) => (
            <option key={entry.server.id} value={entry.server.id}>
              {entry.server.label}
              {entry.server.dataClassification === "public-read" ? " (public data)" : ""}
            </option>
          ))}
        </select>
        {!mcpServersLoading && mcpServers.length === 0 && (
          <p className="text-[12px] text-[#736d5f]">
            No active MCP servers. Register one on the MCP Servers page.
          </p>
        )}
      </div>

      <div className="space-y-1">
        <Label htmlFor="mcp-tool">Tool</Label>
        {selectedMcpServer && selectedMcpServer.tools.length === 0 ? (
          <Input
            id="mcp-tool"
            value={values.mcpToolName}
            onChange={(e) => set("mcpToolName", e.target.value)}
            placeholder="Type the tool name (server exposed none / unreachable)"
          />
        ) : (
          <select
            id="mcp-tool"
            className={SELECT_CLASS}
            value={values.mcpToolName}
            disabled={!selectedMcpServer}
            onChange={(e) => chooseTool(e.target.value)}
          >
            <option value="">Select a tool…</option>
            {selectedMcpServer?.tools.map((tool) => (
              <option key={tool.name} value={tool.name}>
                {tool.title ?? tool.name}
              </option>
            ))}
          </select>
        )}
        {parameters.length > 0 && (
          <ul className="mt-1 space-y-0.5 rounded-[9px] border border-[#e7e3db] px-3 py-2 text-[12px] text-[#5c574c]">
            {parameters.map((parameter) => (
              <li key={parameter.name}>
                <code className="text-[#1c1b19]">{parameter.name}</code> · {parameter.type}
                {parameter.required ? " · required" : ""}
                {parameter.description ? ` — ${parameter.description}` : ""}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="space-y-1">
        <Label htmlFor="mcp-instruction">Instructions for resolving inputs</Label>
        <Textarea
          id="mcp-instruction"
          rows={3}
          value={values.instruction}
          onChange={(e) => set("instruction", e.target.value)}
          placeholder="Describe how to fill the tool's request fields from the conversation…"
        />
      </div>

      <TemplateFieldEditor
        label="Request fields (tool arguments)"
        helpText="Fields sent as the tool's arguments. Use the same Label (type) syntax as document templates."
        lines={requestLines}
        onChange={setRequestLines}
      />
      {requestFields.length > 0 && (
        <div className="space-y-2">
          <FieldGroupLabel id="ncm-mcp-field-values">Field values</FieldGroupLabel>
          <FieldValueList
            fields={requestFields}
            values={values.requestFieldValues}
            onChange={setFieldValue}
            priorStepFields={priorStepFields}
          />
        </div>
      )}
      <TemplateFieldEditor
        label="Response fields (use a field with key “output” to capture the result)"
        helpText="The tool result is provided under the key output. Add a response field named Output to store it."
        lines={responseLines}
        onChange={setResponseLines}
      />
    </>
  );
}
