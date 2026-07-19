import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { ISSUES_VIEW_ID } from '../ui/issuesView';
import { TREE_VIEW_ID } from '../ui/treeView';

type PackageJson = {
  contributes?: {
    views?: Record<string, Array<{ id: string; type?: string }>>;
    viewsContainers?: {
      activitybar?: Array<{ id: string; icon?: string }>;
    };
  };
};

describe('sidebar contributions', () => {
  const packageJson = JSON.parse(
    readFileSync(join(process.cwd(), 'package.json'), 'utf-8').replace(/^\uFEFF/, '')
  ) as PackageJson;
  const devstackViews = packageJson.contributes?.views?.devstack ?? [];

  it('tree view id matches package.json', () => {
    const declared = devstackViews.find((view) => view.type !== 'webview')?.id;
    assert.equal(TREE_VIEW_ID, declared);
    assert.equal(TREE_VIEW_ID, 'devstack.groups');
  });

  it('events webview id matches package.json', () => {
    const declared = devstackViews.find((view) => view.type === 'webview')?.id;
    assert.equal(ISSUES_VIEW_ID, declared);
    assert.equal(ISSUES_VIEW_ID, 'devstack.issues');
  });

  it('uses a packaged SVG file for the Activity Bar container', () => {
    const container = packageJson.contributes?.viewsContainers?.activitybar?.find(
      (candidate) => candidate.id === 'devstack'
    );
    assert.ok(container?.icon);
    assert.equal(container.icon.startsWith('$('), false);
    assert.equal(container.icon.endsWith('.svg'), true);
    assert.equal(existsSync(join(process.cwd(), container.icon)), true);
  });
});
