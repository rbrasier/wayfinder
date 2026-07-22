"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, File as FileIcon, Folder } from "lucide-react";

// One uploaded sample file, carried in the editor's state until a sample runs.
export interface UploadedFile {
  name: string;
  // Preserved folder path, e.g. "acme/pricing.pdf" — drives the tree structure.
  path: string;
  mimeType: string;
  contentBase64: string;
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

function FolderRow({ node, depth }: { node: TreeNode; depth: number }) {
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
            <FolderRow key={child.name} node={child} depth={depth + 1} />
          ))}
          {node.files.map((file) => (
            <FileRow key={file.path} file={file} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

function FileRow({ file, depth }: { file: UploadedFile; depth: number }) {
  return (
    <div
      className="flex items-center gap-[6px] py-[3px] text-[13px] text-[#5a5650]"
      style={{ paddingLeft: `${depth * 16 + 20}px` }}
    >
      <FileIcon className="h-[13px] w-[13px] shrink-0 text-[#8a857c]" />
      <span className="truncate">{file.name}</span>
    </div>
  );
}

export function UploadTree({ files }: { files: UploadedFile[] }) {
  if (files.length === 0) {
    return <p className="py-[8px] text-[12.5px] text-[#8a857c]">No files uploaded yet.</p>;
  }

  const root = buildTree(files);
  return (
    <div className="mt-[8px]">
      {[...root.children.values()].map((child) => (
        <FolderRow key={child.name} node={child} depth={0} />
      ))}
      {root.files.map((file) => (
        <FileRow key={file.path} file={file} depth={0} />
      ))}
    </div>
  );
}
