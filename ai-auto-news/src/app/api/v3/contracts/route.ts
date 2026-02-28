import { NextRequest, NextResponse } from 'next/server';
import { getLogger } from '@/lib/logger';
import { getContractTestingEngine, type Contract } from '@/lib/contractTestingEngine';

const logger = getLogger();

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const consumer = searchParams.get('consumer');
  const provider = searchParams.get('provider');
  const status = searchParams.get('status');

  try {
    const engine = getContractTestingEngine();

    // Access the internal contracts map via type cast – no public list method exists
    const engineInternal = engine as unknown as { contracts: Map<string, Contract> };
    const allContracts = Array.from(engineInternal.contracts.values());
    const filtered = allContracts.filter(contract => {
      if (consumer && contract.consumer !== consumer) return false;
      if (provider && contract.provider !== provider) return false;
      if (status && contract.status !== status) return false;
      return true;
    });

    const stats = engine.getStats();

    logger.info('Contracts listed', {
      total: allContracts.length,
      filtered: filtered.length,
      consumer,
      provider,
      status,
    });

    return NextResponse.json({
      success: true,
      data: {
        contracts: filtered,
        stats: {
          totalContracts: stats.totalContracts,
          verifiedContracts: stats.verifiedContracts,
          brokenContracts: stats.brokenContracts,
          avgVerificationTime: stats.avgVerificationTime,
        },
        filters: { consumer, provider, status },
      },
    });
  } catch (error) {
    logger.error('Failed to list contracts', undefined, { error });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  let body: {
    action: 'publish' | 'verify' | 'check_compatibility';
    contract?: Record<string, unknown>;
    contractId?: string;
    newVersion?: Record<string, unknown>;
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { action, contract, contractId, newVersion } = body;

  if (!action) {
    return NextResponse.json({ error: 'action is required' }, { status: 400 });
  }

  try {
    const engine = getContractTestingEngine();

    if (action === 'publish') {
      if (!contract) {
        return NextResponse.json({ error: 'contract is required for action=publish' }, { status: 400 });
      }
      const publishedId = engine.publishContract(contract as Parameters<typeof engine.publishContract>[0]);
      logger.info('Contract published', { contractId: publishedId });
      return NextResponse.json({ success: true, data: { contractId: publishedId } });
    }

    if (action === 'verify') {
      if (!contractId) {
        return NextResponse.json({ error: 'contractId is required for action=verify' }, { status: 400 });
      }
      // Synthesise a minimal provider spec so verification can run without a live provider
      const syntheticProvider = { endpoints: [] } as unknown as Parameters<typeof engine.verifyContract>[1];
      const verificationResult = await engine.verifyContract(contractId, syntheticProvider);
      logger.info('Contract verified', {
        contractId,
        passed: verificationResult.passed,
        failures: verificationResult.failures?.length ?? 0,
      });
      return NextResponse.json({ success: true, data: { verification: verificationResult } });
    }

    if (action === 'check_compatibility') {
      if (!contractId || !newVersion) {
        return NextResponse.json(
          { error: 'contractId and newVersion are required for action=check_compatibility' },
          { status: 400 },
        );
      }
      const compatibility = engine.checkCompatibility(
        contractId,
        newVersion as Parameters<typeof engine.checkCompatibility>[1],
      );
      logger.info('Compatibility check complete', {
        contractId,
        compatible: compatibility.compatible,
        breakingChanges: compatibility.breakingChanges?.length ?? 0,
      });
      return NextResponse.json({ success: true, data: { compatibility } });
    }

    return NextResponse.json(
      { error: `Unknown action '${action}'. Valid actions: publish, verify, check_compatibility` },
      { status: 400 },
    );
  } catch (error) {
    logger.error('Contracts API error', undefined, { action, error });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 },
    );
  }
}
