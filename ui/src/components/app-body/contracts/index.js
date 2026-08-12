/*
  Contracts config view — paste or upload deploy JSON (no private keys).
*/
import React, { useState } from 'react'
import { Container, Row, Col, Card, Form, Button, Alert, Table } from 'react-bootstrap'
import { Link } from 'react-router-dom'
import {
  parseDeployConfigJson,
  createProvider,
  instantiateContracts,
  pkhToCashAddr
} from '../../../services/psffpp'
import exampleJson from '../../../contracts/deploy.example.json'

function ContractsConfig (props) {
  const appData = props.appData
  const [text, setText] = useState(
    appData.deployConfig ? JSON.stringify(appData.deployConfig, null, 2) : ''
  )
  const [error, setError] = useState(null)
  const [derived, setDerived] = useState(null)
  const [busy, setBusy] = useState(false)

  const deriveAddresses = async (cfg) => {
    const provider = createProvider(cfg.network || 'mainnet')
    const { pool, shares } = instantiateContracts(cfg, provider)
    return {
      poolAddress: pool.address,
      shares: shares.map((s, i) => ({
        index: i,
        name: cfg.nodes[i].name || `node${i}`,
        address: s.address,
        payoutAddress: pkhToCashAddr(cfg.nodes[i].pkh, cfg.network || 'mainnet')
      })),
      treasuryAddress: pkhToCashAddr(cfg.treasuryPkh, cfg.network || 'mainnet'),
      splitBlockheight: cfg.splitBlockheight,
      minConsolidation: cfg.minConsolidation
    }
  }

  const handleSave = async () => {
    setError(null)
    setBusy(true)
    try {
      const cfg = parseDeployConfigJson(text)
      const addrs = await deriveAddresses(cfg)
      appData.setDeployConfig(cfg)
      setDerived(addrs)
    } catch (err) {
      setError(err.message || String(err))
      setDerived(null)
    } finally {
      setBusy(false)
    }
  }

  const handleClear = () => {
    appData.setDeployConfig(null)
    setText('')
    setDerived(null)
    setError(null)
  }

  const handleLoadExample = () => {
    setText(JSON.stringify(exampleJson, null, 2))
    setError(null)
  }

  const handleFile = (e) => {
    const file = e.target.files && e.target.files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      setText(String(reader.result || ''))
      setError(null)
    }
    reader.onerror = () => setError('Failed to read file')
    reader.readAsText(file)
  }

  // Re-derive on mount if config already saved
  React.useEffect(() => {
    if (!appData.deployConfig) return
    let cancelled = false
    ;(async () => {
      try {
        const addrs = await deriveAddresses(appData.deployConfig)
        if (!cancelled) setDerived(addrs)
      } catch (err) {
        if (!cancelled) setError(err.message || String(err))
      }
    })()
    return () => { cancelled = true }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Container className='mt-3'>
      <Row className='justify-content-center'>
        <Col lg={10}>
          <Card className='mb-3'>
            <Card.Body>
              <Card.Title>Federation Deploy Config</Card.Title>
              <Card.Text>
                Paste or upload the same JSON used by the CLI
                (<code>config/deploy.mainnet.json</code>). No private keys.
                Config is stored in this browser&apos;s localStorage.
              </Card.Text>

              {error && <Alert variant='danger'>{error}</Alert>}

              <Form.Group className='mb-3'>
                <Form.Label>Deploy JSON</Form.Label>
                <Form.Control
                  as='textarea'
                  rows={16}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  style={{ fontFamily: 'monospace', fontSize: '0.85rem' }}
                />
              </Form.Group>

              <Form.Group className='mb-3'>
                <Form.Label>Or upload a file</Form.Label>
                <Form.Control type='file' accept='.json,application/json' onChange={handleFile} />
              </Form.Group>

              <div className='d-flex flex-wrap gap-2'>
                <Button variant='primary' onClick={handleSave} disabled={busy || !text.trim()}>
                  {busy ? 'Validating…' : 'Save & derive addresses'}
                </Button>
                <Button variant='outline-secondary' onClick={handleLoadExample}>
                  Load example template
                </Button>
                <Button variant='outline-danger' onClick={handleClear}>
                  Clear
                </Button>
              </div>
            </Card.Body>
          </Card>

          {derived && (
            <Card>
              <Card.Body>
                <Card.Title>Derived addresses</Card.Title>
                <p>
                  Split height: <strong>{derived.splitBlockheight}</strong>
                  {' · '}
                  Min consolidation: <strong>{derived.minConsolidation}</strong> sats
                </p>
                <Table responsive size='sm' bordered>
                  <tbody>
                    <tr>
                      <th>Pool</th>
                      <td style={{ wordBreak: 'break-all' }}>{derived.poolAddress}</td>
                    </tr>
                    <tr>
                      <th>Treasury</th>
                      <td style={{ wordBreak: 'break-all' }}>{derived.treasuryAddress}</td>
                    </tr>
                    {derived.shares.map((s) => (
                      <React.Fragment key={s.index}>
                        <tr>
                          <th>Share {s.index} ({s.name})</th>
                          <td style={{ wordBreak: 'break-all' }}>{s.address}</td>
                        </tr>
                        <tr>
                          <th>Payout {s.index}</th>
                          <td style={{ wordBreak: 'break-all' }}>{s.payoutAddress}</td>
                        </tr>
                      </React.Fragment>
                    ))}
                  </tbody>
                </Table>
                <Button as={Link} to='/pool' variant='success'>
                  View pool status
                </Button>
              </Card.Body>
            </Card>
          )}
        </Col>
      </Row>
    </Container>
  )
}

export default ContractsConfig
