import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { ISSUES_VIEW_ID } from '../ui/issuesView';
import { TREE_VIEW_ID } from '../ui/treeView';

type PackageJson = {
  contributes?: {
    views?: Record<string, Array<{ id: string; type?: string }>>;
  };
};

describe('sidebar view ids', () => {
  const packageJson = JSON.parse(
    readFileSync(join(process.cwd(), 'package.json'), 'utf-8').replace(/^\uFEFF/, '')
  ) as PackageJson;

  const devstackViews = packageJson.contributes?.views?.devstack ?? [];

  it('tree view id matches package.json', () => {
    const declared = devstackViews.find((view) => view.type !== 'webview')?.id;
    assert.equal(TREE_VIEW_ID, declared);
    assert.equal(TREE_VIEW_ID, 'devstack.groups');
  });

  it('issues webview id matches package.json', () => {
    const declared = devstackViews.find((view) => view.type === 'webview')?.id;
    assert.equal(ISSUES_VIEW_ID, declared);
    assert.equal(ISSUES_VIEW_ID, 'devstack.issues');
  });
});
