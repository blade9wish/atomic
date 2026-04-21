import { oneDark } from '@codemirror/theme-one-dark';
import { CrepeBuilder } from '@milkdown/crepe/builder';
import { blockEdit } from '@milkdown/crepe/feature/block-edit';
import { codeMirror } from '@milkdown/crepe/feature/code-mirror';
import { imageBlock } from '@milkdown/crepe/feature/image-block';
import { listItem } from '@milkdown/crepe/feature/list-item';
import { placeholder } from '@milkdown/crepe/feature/placeholder';
import { table } from '@milkdown/crepe/feature/table';

import { ATOMIC_CODE_LANGUAGES } from '../codemirror/code-languages';

// We import Crepe features individually instead of using the batteries-included
// `Crepe` class, because `@milkdown/crepe`'s root module statically imports
// every feature (katex, the toolbar's katex, prosemirror-virtual-cursor, …).
// Runtime `features: { [X]: false }` toggles can't tree-shake those — only
// omitting the import from the module graph does. Dropping `latex` + `toolbar`
// is what pulled the editor chunk under the workbox precache ceiling.
//
// If you need a feature back, add its `@milkdown/crepe/feature/<name>` import
// and a matching `.addFeature(...)` call below.

export type AtomicCrepeOptions = {
  root: HTMLElement;
  defaultValue?: string;
  placeholderText?: string;
  imageBlockUploadPlaceholder?: string;
};

export function buildAtomicCrepe(options: AtomicCrepeOptions): CrepeBuilder {
  const {
    root,
    defaultValue = '',
    placeholderText = '',
    imageBlockUploadPlaceholder = 'paste link',
  } = options;

  return new CrepeBuilder({ root, defaultValue })
    .addFeature(codeMirror, { languages: ATOMIC_CODE_LANGUAGES, theme: oneDark })
    .addFeature(listItem)
    .addFeature(imageBlock, {
      inlineUploadButton: '',
      inlineUploadPlaceholderText: imageBlockUploadPlaceholder,
      blockUploadButton: '',
      blockUploadPlaceholderText: imageBlockUploadPlaceholder,
    })
    .addFeature(blockEdit)
    .addFeature(placeholder, { text: placeholderText })
    .addFeature(table);
}
