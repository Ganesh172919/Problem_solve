import { describe, it, expect, beforeEach } from '@jest/globals';
import {
  IntelligentDataMasking,
  getDataMasking,
  MaskingPolicy,
} from '../../../src/lib/intelligentDataMasking';

function buildPolicy(engine: IntelligentDataMasking, allowedRoles: string[] = ['admin']): MaskingPolicy {
  return engine.createPolicy({
    name: 'Test Policy',
    tenantId: 'tenant1',
    allowedRoles,
    fieldRules: [
      { fieldName: 'email', category: 'email', strategy: 'partial_mask' },
      { fieldName: 'ssn', category: 'ssn', strategy: 'redact' },
      { fieldName: 'amount', category: 'custom', strategy: 'noise_inject', noiseLevel: 0.1 },
    ],
    complianceFrameworks: ['GDPR', 'CCPA'],
    active: true,
  });
}

describe('IntelligentDataMasking', () => {
  beforeEach(() => {
    (globalThis as Record<string, unknown>)['__intelligentDataMasking__'] = undefined;
  });

  it('singleton returns same instance', () => {
    const a = getDataMasking();
    const b = getDataMasking();
    expect(a).toBe(b);
  });

  it('creates a policy and retrieves it', () => {
    const engine = new IntelligentDataMasking();
    const policy = buildPolicy(engine);
    expect(policy.policyId).toBeTruthy();
    expect(engine.getPolicy(policy.policyId)).toBe(policy);
  });

  it('maskRecord masks fields for non-admin caller', () => {
    const engine = new IntelligentDataMasking();
    const policy = buildPolicy(engine);
    const record = { email: 'user@example.com', ssn: '123-45-6789', name: 'John Doe', amount: 100 };
    const { maskedData, result } = engine.maskRecord(record, policy.policyId, 'viewer');
    expect(maskedData['ssn']).toBe('[REDACTED]');
    expect(maskedData['email']).not.toBe('user@example.com');
    expect(result.maskedFieldCount).toBeGreaterThan(0);
    expect(result.auditId).toBeTruthy();
  });

  it('maskRecord does NOT mask fields for allowed role', () => {
    const engine = new IntelligentDataMasking();
    const policy = buildPolicy(engine, ['admin']);
    const record = { email: 'user@example.com', ssn: '123-45-6789' };
    const { maskedData } = engine.maskRecord(record, policy.policyId, 'admin');
    expect(maskedData['email']).toBe('user@example.com');
    expect(maskedData['ssn']).toBe('123-45-6789');
  });

  it('detectPII identifies email and SSN patterns', () => {
    const engine = new IntelligentDataMasking();
    const detected = engine.detectPII({ contact: 'reach@test.org', id: '987-65-4321' });
    const categories = detected.map(d => d.category);
    expect(categories).toContain('email');
    expect(categories).toContain('ssn');
  });

  it('tokenize + detokenize returns non-null for reversible tokens', () => {
    const engine = new IntelligentDataMasking();
    const policy = engine.createPolicy({
      name: 'Token Policy',
      tenantId: 'tenant2',
      allowedRoles: [],
      fieldRules: [{ fieldName: 'card', category: 'credit_card', strategy: 'tokenize', reversible: true }],
      complianceFrameworks: ['PCI_DSS'],
      active: true,
    });
    const { maskedData } = engine.maskRecord({ card: '4111111111111111' }, policy.policyId, 'user');
    const token = maskedData['card'] as string;
    expect(token).toBeTruthy();
    const detokenized = engine.detokenize(token, 'tenant2');
    expect(detokenized).not.toBeNull();
  });

  it('enforceKAnonymity suppresses rare groups', () => {
    const engine = new IntelligentDataMasking();
    const records = [
      { age: 25, zip: '10001', name: 'Alice' },
      { age: 25, zip: '10001', name: 'Bob' },
      { age: 25, zip: '10001', name: 'Carol' },
      { age: 25, zip: '10001', name: 'Dave' },
      { age: 25, zip: '10001', name: 'Eve' },
      { age: 99, zip: '99999', name: 'Rare' },  // only 1 record -> suppressed with k=5
    ];
    const { report } = engine.enforceKAnonymity(records, ['age', 'zip'], 5);
    expect(report.suppressedRecords).toBe(1);
    expect(report.compliant).toBe(true);
  });

  it('bulkMask processes multiple records', () => {
    const engine = new IntelligentDataMasking();
    const policy = buildPolicy(engine);
    const records = [{ email: 'a@b.com', ssn: '111-22-3333' }, { email: 'c@d.com', ssn: '444-55-6666' }];
    const results = engine.bulkMask(records, policy.policyId, 'viewer');
    expect(results).toHaveLength(2);
    expect(results[0]!.maskedData['ssn']).toBe('[REDACTED]');
  });
});
