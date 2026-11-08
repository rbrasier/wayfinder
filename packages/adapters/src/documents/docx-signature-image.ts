import type PizZip from "pizzip";
import { readPngDimensions } from "@wayfinder/domain";

// Drawn signatures in .docx (ADR-067 §2). docxtemplater's image module is a paid
// add-on, so a slot that carries an image is rendered with a marker on its own
// line ahead of the attestation text, and the marker's text element is then
// swapped for an inline picture. A fixed-size inline picture is a small, stable
// corner of the OOXML spec — the part every .docx reader renders.

const MARKER_PREFIX = "⟦wf-img:";
const MARKER_SUFFIX = "⟧";

const SIGNATURE_HEIGHT_EMU = 457200;
const MAX_SIGNATURE_WIDTH_EMU = 1828800;

const RELATIONSHIP_IMAGE =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image";

export const signatureImageMarker = (key: string): string => `${MARKER_PREFIX}${key}${MARKER_SUFFIX}`;

// Prefixes each decided slot's text with its marker. An empty slot is undecided
// and must stay blank — a picture there would imply a signature never given.
export const markSignatureSlots = (
  data: Record<string, unknown>,
  images: Record<string, Buffer>,
): Record<string, unknown> => {
  const marked = { ...data };
  for (const key of Object.keys(images)) {
    const value = marked[key];
    if (typeof value !== "string" || value.length === 0) continue;
    if (!readPngDimensions(images[key]!)) continue;
    marked[key] = `${signatureImageMarker(key)}\n${value}`;
  }
  return marked;
};

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const extentFor = (image: Buffer): { width: number; height: number } => {
  const dimensions = readPngDimensions(image)!;
  const width = Math.round((SIGNATURE_HEIGHT_EMU * dimensions.width) / dimensions.height);
  if (width <= MAX_SIGNATURE_WIDTH_EMU) return { width, height: SIGNATURE_HEIGHT_EMU };
  return {
    width: MAX_SIGNATURE_WIDTH_EMU,
    height: Math.round((MAX_SIGNATURE_WIDTH_EMU * dimensions.height) / dimensions.width),
  };
};

const drawingXml = (relationshipId: string, pictureId: number, key: string, image: Buffer): string => {
  const { width, height } = extentFor(image);
  const name = `Signature ${key}`;
  return (
    `<w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0" ` +
    `xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing">` +
    `<wp:extent cx="${width}" cy="${height}"/>` +
    `<wp:docPr id="${pictureId}" name="${name}"/>` +
    `<wp:cNvGraphicFramePr/>` +
    `<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">` +
    `<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
    `<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
    `<pic:nvPicPr><pic:cNvPr id="${pictureId}" name="${name}"/><pic:cNvPicPr/></pic:nvPicPr>` +
    `<pic:blipFill><a:blip r:embed="${relationshipId}" ` +
    `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/>` +
    `<a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
    `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${width}" cy="${height}"/></a:xfrm>` +
    `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>` +
    `</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing>`
  );
};

const relationshipsPathFor = (partName: string): string => {
  const slash = partName.lastIndexOf("/");
  return `${partName.slice(0, slash)}/_rels/${partName.slice(slash + 1)}.rels`;
};

const EMPTY_RELATIONSHIPS =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>';

const addRelationship = (zip: PizZip, partName: string, relationshipId: string, target: string): void => {
  const path = relationshipsPathFor(partName);
  const existing = zip.file(path)?.asText() ?? EMPTY_RELATIONSHIPS;
  const entry = `<Relationship Id="${relationshipId}" Type="${RELATIONSHIP_IMAGE}" Target="${target}"/>`;
  zip.file(path, existing.replace("</Relationships>", `${entry}</Relationships>`));
};

const ensurePngContentType = (zip: PizZip): void => {
  const types = zip.file("[Content_Types].xml")?.asText();
  if (!types || /Extension="png"/i.test(types)) return;
  zip.file(
    "[Content_Types].xml",
    types.replace("</Types>", '<Default Extension="png" ContentType="image/png"/></Types>'),
  );
};

const isRenderablePart = (name: string): boolean =>
  name === "word/document.xml" || /^word\/(header|footer)\d*\.xml$/.test(name);

// Swaps each marker for its picture. A marker that did not land in a text
// element of its own is removed rather than left visible — the attestation
// text still stands, which is the evidence.
export const embedSignatureImages = (zip: PizZip, images: Record<string, Buffer>): void => {
  const renderable = Object.entries(images).filter(([, image]) => readPngDimensions(image));
  let pictureId = 9100;
  let relationshipCounter = 0;
  const stored = new Set<string>();

  for (const partName of Object.keys(zip.files).filter(isRenderablePart)) {
    let xml = zip.file(partName)!.asText();
    if (!xml.includes(MARKER_PREFIX)) continue;

    for (const [key, image] of renderable) {
      const marker = escapeRegExp(signatureImageMarker(key));
      // docxtemplater puts the line break after the marker in a run of its own,
      // so the picture's run needs none.
      const isolated = new RegExp(`<w:t(?:\\s[^>]*)?>${marker}</w:t>`, "g");
      if (!isolated.test(xml)) continue;

      const mediaName = `wf-signature-${key}.png`;
      if (!stored.has(mediaName)) {
        zip.file(`word/media/${mediaName}`, image);
        stored.add(mediaName);
      }
      relationshipCounter += 1;
      const relationshipId = `rIdWfSig${relationshipCounter}`;
      addRelationship(zip, partName, relationshipId, `media/${mediaName}`);
      pictureId += 1;
      xml = xml.replace(isolated, drawingXml(relationshipId, pictureId, key, image));
    }

    xml = xml.replace(new RegExp(`${escapeRegExp(MARKER_PREFIX)}[^\\u27E7<]*${MARKER_SUFFIX}`, "g"), "");
    zip.file(partName, xml);
  }

  if (stored.size > 0) ensurePngContentType(zip);
};
