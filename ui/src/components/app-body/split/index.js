/*
  Split pool after height gate. Fee from in-app wallet (auto-carve).
*/
import React, { useState } from 'react'
import { Container, Row, Col, Card, Button, Alert, Form, Table } from 'react-bootstrap'
import { Link } from 'react-router-dom'
import { splitPool, DEFAULT_FEE_RATE } from '../../../services/psffpp'
import { NeedConfig } from '../pool'

function SplitView (props) {
  const appData = props.appData
  const cfg = appData.deployConfig
  const [feeRate, setFeeRate] = useState(String(DEFAULT_FEE_RATE))
  const [statusMsg, setStatusMsg] = useState(null)
  const [preview, setPreview] = useState(null)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  if (!cfg) return <NeedConfig />

  const run = async (dryRun) => {
    setBusy(true)
    setError(null)
    setResult(null)
    setStatusMsg(null)
    try {
      if (!appData.wallet) throw new Error('Wallet not ready')
      const rate = Number(feeRate)
      if (!Number.isFinite(rate) || rate <= 0) throw new Error('feeRate must be a positive number')
      const summary = await splitPool({
        cfg,
        wallet: appData.wallet,
        feeRate: rate,
        dryRun,
        onStatus: setStatusMsg
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
      setStatusMsg(null)
    }
  }

  return (
    <Container className='mt-3'>
      <Row className='justify-content-center'>
        <Col lg={8}>
          <Card>
            <Card.Body>
              <Card.Title>Split pool</Card.Title>
              <Card.Text>
                After <code>splitBlockheight</code>, apportions one pool UTXO into treasury (20%)
                + three equal ShareContracts (80%/3). Miner fee comes from this wallet as a
                companion input. Large UTXOs are never spent as the fee — a small self-send is
                carved when needed.
              </Card.Text>

              {error && <Alert variant='danger'>{error}</Alert>}
              {statusMsg && <Alert variant='info'>{statusMsg}</Alert>}
              {result && (
                <Alert variant='success'>
                  Broadcast OK. txid:{' '}
                  <a href={`https://bch.loping.net/tx/${result.txid}`} target='_blank' rel='noreferrer'>
                    {result.txid}
                  </a>
                  {result.carveTxid && (
                    <div className='mt-1 small'>Carve tx: {result.carveTxid}</div>
                  )}
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

              <p className='small text-muted'>
                Fee payer: {appData.bchWalletState?.cashAddress || '…'}
              </p>

              <div className='d-flex flex-wrap gap-2 mb-3'>
                <Button variant='outline-primary' disabled={busy} onClick={() => run(true)}>
                  {busy ? 'Working…' : 'Preview (dry-run)'}
                </Button>
                <Button variant='success' disabled={busy || !appData.wallet} onClick={() => run(false)}>
                  Broadcast split
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
                      <tr><th>Height</th><td>{preview.chainHeight} / gate {preview.splitBlockheight}</td></tr>
                      <tr><th>Pool value</th><td>{preview.poolValue} sats</td></tr>
                      <tr><th>Treasury</th><td>{preview.treasuryValue} → {preview.treasuryAddr}</td></tr>
                      <tr><th>Each share</th><td>{preview.share} sats</td></tr>
                      <tr><th>Fee UTXO</th><td>{preview.feeUtxo.satoshis} sats (carved: {String(preview.carved)})</td></tr>
                      <tr><th>Est. fee</th><td>{preview.estimatedFeeAtRate} sats</td></tr>
                    </tbody>
                  </Table>
                  {preview.hex && (
                    <details>
                      <summary>Hex</summary>
                      <pre className='small' style={{ wordBreak: 'break-all', whiteSpace: 'pre-wrap' }}>{preview.hex}</pre>
                    </details>
                  )}
                  {preview.carved === 'would_carve' && (
                    <Alert variant='warning' className='mt-2'>
                      Dry-run would carve a {preview.carveAmount}-sat fee UTXO before split.
                    </Alert>
                  )}
                </>
              )}
            </Card.Body>
          </Card>
        </Col>
      </Row>
    </Container>
  )
}

export default SplitView
