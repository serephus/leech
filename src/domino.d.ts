// Minimal types for @mixmark-io/domino (turndown's DOM engine). The package
// ships an ambient `declare module "domino"` that does not match the scoped
// import path, so declare the small surface we use here.
declare module "@mixmark-io/domino" {
  interface DomNode {
    nodeName: string;
    nodeType: number;
    parentNode: DomNode | null;
    ownerDocument: DomDocument | null;
    textContent: string | null;
    childNodes: DomNode[];
    getAttribute(name: string): string | null;
    replaceWith(node: DomNode): void;
  }
  interface DomDocument extends DomNode {
    querySelectorAll(selectors: string): DomNode[];
    createTextNode(text: string): DomNode;
    outerHTML: string;
    body: DomNode;
  }
  export function createDocument(html?: string, force?: boolean): DomDocument;
  export function createWindow(html?: string, address?: string): unknown;
}
