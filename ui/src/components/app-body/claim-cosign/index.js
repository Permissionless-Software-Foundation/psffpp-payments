/*
  Claim cosign — produce psffpp-share-claim-sig JSON using CashScript ECDSA.
*/
import React, { useState, useEffect } from 'react'
import { Container, Row, Col, Card, Button, Alert, Form } from 'react-bootstrap'
import { Link } from 'react-router-dom'
import { cosignClaim, listShareUtxos, DEFAULT_FEE_RATE } from '../../../services/psffpp'
import { NeedConfig } from '../pool'

function ClaimCosignView (props) {
  const appData = props.appData
  const cfg = appData.deployConfig
  const [shareIndex, setShareIndex] = useState(0)
  const [utxoRef, setUtxoRef] = useState('')
  const [utxoOptions, setUtxoOptions] = useState([])
  const [feeRate, setFeeRate] = useState(String(DEFAULT_FEE_RATE))
  const [doc, setDoc] = useState(null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!cfg) return
    let cancelled = false
    ;(async () => {
      try {
        const info = await listShareUtxos(cfg, shareIndex)
        if (!cancelled) {
          setUtxoOptions(info.utxos)
          setUtxoRef(info.utxos.length === 1 ? info.utxos[0].ref : '')
        }
      } catch (err) {
        if (!cancelled) {
          setUtxoOptions([])
          setError(err.message || String(err))
        }
      }
    })()
    return () => { cancelled = true }
  }, [cfg, shareIndex])

  if (!cfg) return <NeedConfig />

  const run = async () => {
    setBusy(true)
    setError(null)
    setDoc(null)
    try {
      if (!appData.wallet) throw new Error('Wallet not ready')
      const rate = Number(feeRate)
      const envelope = await cosignClaim({
        cfg,
        wallet: appData.wallet,
        shareIndex: Number(shareIndex),
        utxoRef: utxoRef || null,
        feeRate: rate
      })
      setDoc(envelope)
    } catch (err) {
      setError(err.message || String(err))
    } finally {
      setBusy(false)
    }
  }

  const download = () => {
    if (!doc) return
    const blob = new Blob([JSON.stringify(doc, null, 2) + '\n'], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `claim-sig-share${doc.claim.shareIndex}-by-node${doc.signer.nodeIndex}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const copy = async () => {
    if (!doc) return
    await navigator.clipboard.writeText(JSON.stringify(doc, null, 2))
  }

  return (
    <Container className='mt-3'>
      <Row className='justify-content-center'>
        <Col lg={8}>
          <Card>
            <Card.Body>
              <Card.Title>Claim cosign</Card.Title>
              <Alert variant='warning'>
                This signs the <em>claim transaction</em> with CashScript ECDSA
                (<code>SIGHASH_ALL|UTXOS</code>). The Sign menu&apos;s Bitcoin message
                signatures cannot unlock ShareContract.claim.
              </Alert>
              <Card.Text>
                <strong>share index</strong> = which node&apos;s share UTXO is being claimed.
                Your wallet pubkey selects the signer slot (must match a config node pubkey).
                Give the JSON to the claimant; they need ≥2 distinct cosigners for the same claim params.
              </Card.Text>

              {error && <Alert variant='danger'>{error}</Alert>}

              <Form.Group className='mb-3'>
                <Form.Label>Share being claimed</Form.Label>
                <Form.Select
                  value={shareIndex}
                  onChange={(e) => setShareIndex(Number(e.target.value))}
                >
                  {cfg.nodes.map((n, i) => (
                    <option key={i} value={i}>
                      {i} — {n.name || `node${i}`}
                    </option>
                  ))}
                </Form.Select>
              </Form.Group>

              <Form.Group className='mb-3'>
                <Form.Label>Share UTXO</Form.Label>
                {utxoOptions.length === 0
                  ? <Form.Text className='d-block text-muted'>No UTXOs on this share</Form.Text>
                  : (
                    <Form.Select value={utxoRef} onChange={(e) => setUtxoRef(e.target.value)}>
                      <option value=''>— select —</option>
                      {utxoOptions.map((u) => (
                        <option key={u.ref} value={u.ref}>
                          {u.ref} ({u.satoshis} sats)
                        </option>
                      ))}
                    </Form.Select>
                    )}
              </Form.Group>

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
                <Button
                  variant='primary'
                  disabled={busy || !appData.wallet || !utxoRef}
                  onClick={run}
                >
                  {busy ? 'Signing…' : 'Generate claim signature'}
                </Button>
                <Button as={Link} to='/claim' variant='outline-secondary'>
                  Go to claim broadcast
                </Button>
              </div>

              {doc && (
                <>
                  <Alert variant='success'>
                    Signed as node {doc.signer.nodeIndex} ({doc.signer.name}) for share{' '}
                    {doc.claim.shareIndex}. Payout {doc.claim.payoutSatoshis} sats
                    (fee {doc.claim.feeSatoshis}).
                  </Alert>
                  <div className='d-flex gap-2 mb-2'>
                    <Button size='sm' onClick={download}>Download JSON</Button>
                    <Button size='sm' variant='outline-secondary' onClick={copy}>Copy JSON</Button>
                  </div>
                  <pre
                    className='small p-2 border rounded'
                    style={{ maxHeight: 320, overflow: 'auto' }}
                  >
                    {JSON.stringify(doc, null, 2)}
                  </pre>
                </>
              )}
            </Card.Body>
          </Card>
        </Col>
      </Row>
    </Container>
  )
}

export default ClaimCosignView
