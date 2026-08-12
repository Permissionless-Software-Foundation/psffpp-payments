/*
  Claim broadcast — assemble ≥2 claim-sig JSON files and broadcast.
*/
import React, { useState } from 'react'
import { Container, Row, Col, Card, Button, Alert, Form, Table } from 'react-bootstrap'
import { Link } from 'react-router-dom'
import { broadcastClaim, parseClaimSigDoc } from '../../../services/psffpp'
import { NeedConfig } from '../pool'

function ClaimBroadcastView (props) {
  const appData = props.appData
  const cfg = appData.deployConfig
  const [sig1, setSig1] = useState('')
  const [sig2, setSig2] = useState('')
  const [sig3, setSig3] = useState('')
  const [preview, setPreview] = useState(null)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  if (!cfg) return <NeedConfig />

  const collectDocs = () => {
    const texts = [sig1, sig2, sig3].map((t) => t.trim()).filter(Boolean)
    if (texts.length < 2) {
      throw new Error('Paste at least two claim-sig JSON documents')
    }
    return texts.map((t) => parseClaimSigDoc(t))
  }

  const loadFileInto = (setter) => (e) => {
    const file = e.target.files && e.target.files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => setter(String(reader.result || ''))
    reader.readAsText(file)
  }

  const run = async (dryRun) => {
    setBusy(true)
    setError(null)
    setResult(null)
    try {
      const docs = collectDocs()
      const summary = await broadcastClaim({
        cfg,
        wallet: appData.wallet,
        sigDocs: docs,
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
        <Col lg={9}>
          <Card>
            <Card.Body>
              <Card.Title>Claim broadcast</Card.Title>
              <Card.Text>
                Paste or upload ≥2 <code>psffpp-share-claim-sig</code> JSON files for the
                <em> same</em> claim (identical payout, UTXO, fee). Unused signature slots
                are empty bytes. Changing payout/fee after cosigning invalidates all signatures.
              </Card.Text>

              {error && <Alert variant='danger'>{error}</Alert>}
              {result && (
                <Alert variant='success'>
                  Claim broadcast OK. txid:{' '}
                  <a href={`https://bch.loping.net/tx/${result.txid}`} target='_blank' rel='noreferrer'>
                    {result.txid}
                  </a>
                </Alert>
              )}

              {[
                { label: 'Signature 1', value: sig1, set: setSig1 },
                { label: 'Signature 2', value: sig2, set: setSig2 },
                { label: 'Signature 3 (optional)', value: sig3, set: setSig3 }
              ].map((slot) => (
                <Form.Group className='mb-3' key={slot.label}>
                  <Form.Label>{slot.label}</Form.Label>
                  <Form.Control
                    as='textarea'
                    rows={6}
                    value={slot.value}
                    onChange={(e) => slot.set(e.target.value)}
                    style={{ fontFamily: 'monospace', fontSize: '0.75rem' }}
                  />
                  <Form.Control
                    type='file'
                    accept='.json,application/json'
                    className='mt-1'
                    onChange={loadFileInto(slot.set)}
                  />
                </Form.Group>
              ))}

              <div className='d-flex flex-wrap gap-2 mb-3'>
                <Button variant='outline-primary' disabled={busy} onClick={() => run(true)}>
                  Preview
                </Button>
                <Button variant='primary' disabled={busy || !appData.wallet} onClick={() => run(false)}>
                  Broadcast claim
                </Button>
                <Button as={Link} to='/claim/cosign' variant='link'>
                  Cosign instead
                </Button>
              </div>

              {preview && (
                <>
                  <h6>Preview</h6>
                  <Table size='sm' bordered>
                    <tbody>
                      <tr><th>Share</th><td>{preview.shareIndex} — {preview.shareAddress}</td></tr>
                      <tr><th>Payout</th><td>{preview.payoutSatoshis} → {preview.payoutAddress}</td></tr>
                      <tr><th>Fee</th><td>{preview.feeSatoshis} sats</td></tr>
                      <tr><th>Signer slots</th><td>{preview.signerSlots.join(', ')}</td></tr>
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

export default ClaimBroadcastView
