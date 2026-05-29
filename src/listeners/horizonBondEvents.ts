/**
 * Horizon Bond Creation Listener
 * Listens for bond creation events from Stellar/Horizon and syncs identity/bond state to DB.
 * @module horizonBondEvents
 */

import { Horizon } from '@stellar/stellar-sdk'
import { upsertIdentity, upsertBond } from '../services/identityService.js'
import { validateMessage } from './messageValidator.js'
import { bondOperationSchema } from './messageValidator.js'

const HORIZON_URL = process.env.HORIZON_URL || 'https://horizon.stellar.org'
const server = new Horizon.Server(HORIZON_URL)

/**
 * Subscribe to bond creation events from Horizon
 * @param {ReplayService} replayService Service to capture failures
 * @param {function} onEvent Callback for each bond creation event
 */
export function subscribeBondCreationEvents(replayService: {
  captureFailure: (type: string, data: any, reason: string) => Promise<unknown>
}, onEvent?: (event: { identity: { id: string }; bond: { id: string; address: string; amount: string; duration: string | null } }) => void) {
  // Example: Listen to operations of type 'create_bond' (custom event)
  let cursor = 'now';
  let stream;
  const startStream = () => {
    stream = (server.operations() as any)
      .forAsset('BOND') // Replace with actual asset code if needed
      .cursor(cursor)
      .stream({
        onmessage: async (op: any) => {
          // Only validate operations that claim to be create_bond operations
          if (op.type === 'create_bond') {
            // Validate the operation before processing
            const validationResult = validateMessage(bondOperationSchema, op);
            
            if (!validationResult.valid) {
              // Send to failed_inbound_events without advancing cursor
              await replayService.captureFailure(
                'bond_creation',
                op,
                validationResult.detail
              );
              return; // Don't advance cursor on validation failure
            }
            
            // Only advance cursor on successful validation
            cursor = op.paging_token;
            
            const event = parseBondEvent(op);
            await upsertIdentity(event.identity);
            await upsertBond(event.bond);
            if (onEvent) onEvent(event)
          } else {
            // For non-create_bond operations, still advance cursor but don't process
            cursor = op.paging_token;
          }
        },
          onerror: (err: unknown) => {
          console.error('Horizon stream error:', err);
          setTimeout(() => {
            startStream(); // Reconnect after delay
          }, 5000);
        }
      });
  };
  startStream();
}

/**
 * Parse bond creation event payload
 * @param {object} op Operation object from Horizon
 * @returns {{identity: object, bond: object}}
 */
function parseBondEvent(op: { source_account: string; id: string; amount: string; duration?: string | null }) {
  // Example parsing logic
  return {
    identity: { id: op.source_account },
    bond: {
      id: op.id,
      address: op.source_account,
      amount: op.amount,
      duration: op.duration ?? null,
    },
  }
}
