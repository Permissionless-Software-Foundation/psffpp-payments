/*
  Consolidate pool UTXOs (permissionless; fee from pool).
*/
import React, { useState } from 'react'
import { Container, Row, Col, Card, Button, Alert, Form, Table } from 'react-bootstrap'
import { Link } from 'react-router-dom'
import { consolidatePool, DEFAULT_FEE_RATE } from '../../../services/psffpp'
import { NeedConfig } from '../pool'

function ConsolidateView (props) {
  const appData = props.appData
  const cfg = appData.deployConfig
  const [feeRate, setFeeRate] = useState(String(DEFAULT_FEE_RATE))
  const [preview, setPreview] = useState(null)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  if (!cfg) return <NeedConfig />

  const run = async (dryRun) => {
    setBusy(true)
    setError(null)
    setResult(null)
    try {
      const rate = Number(feeRate)
      if (!Number.isFinite(rate) || rate <= 0) throw new Error('feeRate must be a positive number')
      const summary = await consolidatePool({
        cfg,
        wallet: appData.wallet,
        feeRate: rate,
        dryRun
      })
      if (dryRun) setPreview(summary)
      else {
        setResult(summary)
        setPreview(null)
      }
    } catch (err) {
      setError(err.message || String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Container className='mt-3'>
      <Row className='justify-content-center'>
        <Col lg={8}>
          <Card>
            <Card.Body>
              <Card.Title>Consolidate pool</Card.Title>
              <Card.Text>
                Merge multiple PoolContract UTXOs into one self-replicating output.
                Permissionless — no operator signatures. Miner fee is taken from the pool.
              </Card.Text>

              {error && <Alert variant='danger'>{error}</Alert>}
              {result && (
                <Alert variant='success'>
                  Broadcast OK. txid:{' '}
                  <a href={`https://bch.loping.net/tx/${result.txid}`} target='_blank' rel='noreferrer'>
                    {result.txid}
                  </a>
                </Alert>
              )}

              <Form.Group className='mb-3'>
                <Form.Label>Fee rate (sats/byte)</Form.Label>
                <Form.Control
                  type='number'
                  step='0.1'
                  min='1'
                  value={feeRate}
                  onChange={(e) => setFeeRate(e.target.value)}
                />
              </Form.Group>

              <div className='d-flex flex-wrap gap-2 mb-3'>
                <Button variant='outline-primary' disabled={busy} onClick={() => run(true)}>
                  {busy ? 'Working…' : 'Preview (dry-run)'}
                </Button>
                <Button variant='primary' disabled={busy || !appData.wallet} onClick={() => run(false)}>
                  Broadcast
                </Button>
                <Button as={Link} to='/pool' variant='link'>
                  Back to pool
                </Button>
              </div>

              {preview && (
                <>
                  <h6>Preview</h6>
                  <Table size='sm' bordered>
                    <tbody>
                      <tr><th>Inputs</th><td>{preview.inputCount}</td></tr>
                      <tr><th>In sum</th><td>{preview.inSum} sats</td></tr>
                      <tr><th>Fee</th><td>{preview.fee} sats</td></tr>
                      <tr><th>Out</th><td>{preview.outAmount} sats</td></tr>
                      <tr><th>Min consolidation</th><td>{preview.minConsolidation}</td></tr>
                    </tbody>
                  </Table>
                  <details>
                    <summary>Hex</summary>
                    <pre className='small' style={{ wordBreak: 'break-all', whiteSpace: 'pre-wrap' }}>{preview.hex}</pre>
                  </details>
                </>
              )}
            </Card.Body>
          </Card>
        </Col>
      </Row>
    </Container>
  )
}

export default ConsolidateView
