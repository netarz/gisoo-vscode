/** Exact-string replacement used by edit_file. Pure. */

export class EditError extends Error {
  constructor(message: string, readonly reason: 'not_found' | 'not_unique' | 'empty' | 'same') {
    super(message);
    this.name = 'EditError';
  }
}

export interface EditResult {
  content: string;
  occurrences: number;
}

function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let idx = 0;
  while ((idx = haystack.indexOf(needle, idx)) >= 0) {
    count++;
    idx += needle.length;
  }
  return count;
}

/**
 * Replaces `oldString` with `newString`. Without `replaceAll` the match must be unique.
 * Line endings: if the file uses CRLF and the search string uses LF, both are tried.
 */
export function applyStringEdit(content: string, oldString: string, newString: string, replaceAll = false): EditResult {
  if (oldString === '') throw new EditError('old_string must not be empty. To create a file use write_file.', 'empty');
  if (oldString === newString) throw new EditError('old_string and new_string are identical; nothing to change.', 'same');

  let needle = oldString;
  let replacement = newString;
  let occurrences = countOccurrences(content, needle);
  if (occurrences === 0 && content.includes('\r\n') && !oldString.includes('\r\n')) {
    needle = oldString.replace(/\n/g, '\r\n');
    replacement = newString.replace(/\r?\n/g, '\r\n');
    occurrences = countOccurrences(content, needle);
  }
  if (occurrences === 0) {
    throw new EditError('old_string was not found in the file. Read the file again and copy the text exactly, including whitespace.', 'not_found');
  }
  if (occurrences > 1 && !replaceAll) {
    throw new EditError(
      `old_string matches ${occurrences} places; include more surrounding lines so it is unique, or set replace_all to true.`,
      'not_unique',
    );
  }
  const result = replaceAll ? content.split(needle).join(replacement) : content.replace(needle, () => replacement);
  return { content: result, occurrences };
}
