export interface DiffLineChangeLike {
  type: 'added' | 'deleted' | 'modified' | 'spacer' | string;
  side?: 'left' | 'right' | 'both' | string;
}

export interface RoleSpecificDiffStats {
  added: number;
  deleted: number;
  modified: number;
}

export function calculateRoleSpecificDiffStats(
  changes: DiffLineChangeLike[],
  role: 'left' | 'right'
): RoleSpecificDiffStats {
  if (role === 'left') {
    return {
      added: changes.filter(change =>
        (change.type === 'spacer' && change.side === 'left') ||
        (change.type === 'added' && (change.side === 'left' || change.side === 'both'))
      ).length,
      deleted: changes.filter(change =>
        change.type === 'deleted' && (change.side === 'left' || change.side === 'both')
      ).length,
      modified: changes.filter(change => change.type === 'modified').length,
    };
  }

  return {
    added: changes.filter(change =>
      change.type === 'added' && (change.side === 'right' || change.side === 'both')
    ).length,
    deleted: changes.filter(change =>
      (change.type === 'spacer' && change.side === 'right') ||
      (change.type === 'deleted' && (change.side === 'right' || change.side === 'both'))
    ).length,
    modified: changes.filter(change => change.type === 'modified').length,
  };
}