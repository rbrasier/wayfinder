import type { FieldReportColumn } from "@wayfinder/domain";

// A column as rendered: either a single raw column or several collapsed into
// one. `memberKeys` lists the raw `columnKey`s whose values it coalesces.
export interface DisplayColumn {
  columnKey: string;
  nodeId: string;
  nodeName: string;
  fieldKey: string;
  label: string;
  type: FieldReportColumn["type"];
  options?: string[];
  memberKeys: string[];
  stepNames: string[];
  nodeType?: FieldReportColumn["nodeType"];
}

// A heading that stands alone, for anywhere a column is read without its step
// beside it — the xlsx export, the pivot's group-by list. An approval step
// projects the same generic labels as every other approval step ("Outcome",
// "Comment"), so its own label identifies nothing; a merged column names the
// steps it coalesced. Everything else is already unambiguous.
export const qualifiedColumnLabel = (column: DisplayColumn): string => {
  if (column.stepNames.length > 1) return `${column.stepNames.join(" · ")} — ${column.label}`;
  if (column.nodeType === "approval") return `${column.nodeName} — ${column.label}`;
  return column.label;
};

// How many passes it took to reach the decision now showing, for the outcome
// cell of an approval step — `null` on a first pass, so the ordinary case reads
// clean and only a step that went back and round again is marked.
//
// The count rides its own column, which is what a report filters and pivots on;
// this is the at-a-glance reading of it, so "approved" beside a step that was
// once sent back does not look like it sailed through first time.
export const approvalRevisionNote = (
  column: DisplayColumn,
  values: Record<string, string>,
): string | null => {
  if (column.nodeType !== "approval" || column.fieldKey !== "outcome") return null;

  const revision = Number(values[`${column.nodeId}:revision`]);
  if (!Number.isFinite(revision) || revision < 2) return null;
  return `Revision ${revision}`;
};

export interface NodeGroup {
  nodeId: string;
  nodeName: string;
  columns: DisplayColumn[];
}

// Union-find over raw columns: two columns merge when they share an *active*
// collapse group (fork-siblings and/or cross-version). Produces one
// DisplayColumn per resulting set, preserving first-seen column order.
export const buildDisplayColumns = (
  columns: FieldReportColumn[],
  combineForks: boolean,
  combineVersions: boolean,
): DisplayColumn[] => {
  const parent = new Map<string, string>();
  const find = (key: string): string => {
    let root = key;
    while (parent.get(root) !== root && parent.get(root) !== undefined) root = parent.get(root)!;
    return root;
  };
  const union = (first: string, second: string): void => {
    parent.set(find(first), find(second));
  };

  for (const column of columns) parent.set(column.columnKey, column.columnKey);

  const firstByGroup = new Map<string, string>();
  for (const column of columns) {
    const groupId =
      (combineForks ? column.collapseGroupId : undefined) ??
      (combineVersions ? column.versionGroupId : undefined);
    if (!groupId) continue;
    const seen = firstByGroup.get(groupId);
    if (seen) union(seen, column.columnKey);
    else firstByGroup.set(groupId, column.columnKey);
  }

  const order: string[] = [];
  const byRoot = new Map<string, FieldReportColumn[]>();
  for (const column of columns) {
    const root = find(column.columnKey);
    const list = byRoot.get(root);
    if (list) {
      list.push(column);
    } else {
      byRoot.set(root, [column]);
      order.push(root);
    }
  }

  return order.map((root) => {
    const members = byRoot.get(root)!;
    const lead = members[0]!;
    const stepNames = [...new Set(members.map((member) => member.nodeName))];
    return {
      columnKey: members.length === 1 ? lead.columnKey : root,
      nodeId: lead.nodeId,
      nodeName: lead.nodeName,
      fieldKey: lead.fieldKey,
      label: lead.label,
      type: lead.type,
      options: lead.options,
      memberKeys: members.map((member) => member.columnKey),
      stepNames,
      nodeType: lead.nodeType,
    };
  });
};
