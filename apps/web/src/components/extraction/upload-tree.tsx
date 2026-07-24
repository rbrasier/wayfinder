"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, File as FileIcon, Folder, X } from "lucide-react";

// One staged input file. Once persisted it carries the server row `id` (used to
// remove it); `contentBase64` is only present transiently while a fresh upload
// is being saved.
export interface UploadedFile {
  id?: string;
  name: string;
  // Preserved folder path, e.g. "acme/pricing.pdf" — drives the tree structure.
  path: string;
  mimeType: string;
  contentBase64?: string;
}

interface TreeNode {
  name: string;
  children: Map<string, TreeNode>;
  files: UploadedFile[];
}

const buildTree = (files: UploadedFile[]): TreeNode => {
  const root: TreeNode = { name: "", children: new Map(), files: [] };
  for (const file of files) {
    const segments = file.path.split("/").filter(Boolean);
    const folders = segments.slice(0, -1);
    let node = root;
    for (const folder of folders) {
      if (!node.children.has(folder)) {
        node.children.set(folder, { name: folder, children: new Map(), files: [] });
      }
      node = node.children.get(folder)!;
    }
    node.files.push(file);
  }
  return root;
};

function FolderRow({
  node,
  depth,
  onRemove,
}: {
  node: TreeNode;
  depth: number;
  onRemove?: (file: UploadedFile) => void;
}) {
  // First level open, second level closed by default (phase §6).
  const [open, setOpen] = useState(depth < 1);
  const childFolders = [...node.children.values()];

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-[6px] py-[3px] text-left text-[13px] text-[#3a352e]"
        style={{ paddingLeft: `${depth * 16}px` }}
        aria-expanded={open}
      >
        {open ? (
          <ChevronDown className="h-[14px] w-[14px] shrink-0 text-[#8a857c]" />
        ) : (
          <ChevronRight className="h-[14px] w-[14px] shrink-0 text-[#8a857c]" />
        )}
        <Folder className="h-[14px] w-[14px] shrink-0 text-[#c79a3e]" />
        <span className="font-medium">{node.name}</span>
      </button>
      {open && (
        <div>
          {childFolders.map((child) => (
            <FolderRow key={child.name} node={child} depth={depth + 1} onRemove={onRemove} />
          ))}
          {node.files.map((file) => (
            <FileRow key={file.id ?? file.path} file={file} depth={depth + 1} onRemove={onRemove} />
          ))}
        </div>
      )}
    </div>
  );
}

function FileRow({
  file,
  depth,
  onRemove,
}: {
  file: UploadedFile;
  depth: number;
  onRemove?: (file: UploadedFile) => void;
}) {
  return (
    <div
      className="group flex items-center gap-[6px] py-[3px] text-[13px] text-[#5a5650]"
      style={{ paddingLeft: `${depth * 16 + 20}px` }}
    >
      <FileIcon className="h-[13px] w-[13px] shrink-0 text-[#8a857c]" />
      <span className="flex-1 truncate">{file.name}</span>
      {onRemove ? (
        <button
          type="button"
          aria-label={`Remove ${file.name}`}
          onClick={() => onRemove(file)}
          className="shrink-0 rounded p-[2px] text-[#b6b1a8] opacity-0 transition hover:bg-[#fbecea] hover:text-[#c2385a] group-hover:opacity-100"
        >
          <X className="h-[13px] w-[13px]" />
        </button>
      ) : null}
    </div>
  );
}

export function UploadTree({
  files,
  onRemove,
}: {
  files: UploadedFile[];
  onRemove?: (file: UploadedFile) => void;
}) {
  if (files.length === 0) {
    return <p className="py-[8px] text-[12.5px] text-[#8a857c]">No files uploaded yet.</p>;
  }

  const root = buildTree(files);
  return (
    <div className="mt-[8px]">
      {[...root.children.values()].map((child) => (
        <FolderRow key={child.name} node={child} depth={0} onRemove={onRemove} />
      ))}
      {root.files.map((file) => (
        <FileRow key={file.id ?? file.path} file={file} depth={0} onRemove={onRemove} />
      ))}
    </div>
  );
}
