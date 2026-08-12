/*
  Pool status — height gate, UTXO counts, CTAs.
*/
import React, { useState, useEffect, useCallback } from 'react'
import { Container, Row, Col, Card, Button, Alert, Table, Spinner } from 'react-bootstrap'
import { Link } from 'react-router-dom'
import { fetchPoolStatus } from '../../../services/psffpp'

function NeedConfig () {
  return (
    <Container className='mt-3'>
      <Alert variant='warning'>
        Load a federation deploy config first.{' '}
        <Alert.Link as={Link} to='/contracts'>Contracts config</Alert.Link>
      </Alert>
    </Container>
  )
}

function PoolStatus (props) {
  const appData = props.appData
  const cfg = appData.deployConfig
  const [status, setStatus] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(async () => {
    if (!cfg) return
    setLoading(true)
    setError(null)
    try {
      const s = await fetchPoolStatus(cfg)
      setStatus(s)
    } catch (err) {
      setError(err.message || String(err))
      setStatus(null)
    } finally {
      setLoading(false)
    }
  }, [cfg])

  useEffect(() => {
    refresh()
  }, [refresh])

  if (!cfg) return <NeedConfig />

  return (
    <Container className='mt-3'>
      <Row className='justify-content-center'>
        <Col lg={10}>
          <Card className='mb-3'>
            <Card.Body>
              <div className='d-flex justify-content-between align-items-center mb-2'>
                <Card.Title className='mb-0'>Pool status</Card.Title>
                <Button size='sm' variant='outline-primary' onClick={refresh} disabled={loading}>
                  {loading ? 'Refreshing…' : 'Refresh'}
                </Button>
              </div>

              {error && <Alert variant='danger'>{error}</Alert>}
              {loading && !status && (
                <div className='text-center py-4'>
                  <Spinner animation='border' />
                </div>
              )}

              {status && (
                <>
                  <p>
                    Chain height: <strong>{status.height}</strong>
                    {' / '}
                    Split gate: <strong>{status.splitBlockheight}</strong>
                    {' — '}
                    {status.gateMet
                      ? <span className='text-success'>gate open</span>
                      : <span className='text-warning'>gate closed</span>}
                  </p>
                  {status.hint && <Alert variant='info'>{status.hint}</Alert>}

                  <h6>Pool</h6>
                  <p style={{ wordBreak: 'break-all' }} className='small mb-1'>{status.poolAddress}</p>
                  <p>
                    UTXOs: <strong>{status.poolUtxoCount}</strong>
                    {' · '}
                    Total: <strong>{status.poolTotalSatoshis}</strong> sats
                  </p>
                  {status.poolUtxos.length > 0 && (
                    <Table size='sm' bordered responsive className='mb-3'>
                      <thead>
                        <tr>
                          <th>txid:vout</th>
                          <th>sats</th>
                        </tr>
                      </thead>
                      <tbody>
                        {status.poolUtxos.map((u) => (
                          <tr key={`${u.txid}:${u.vout}`}>
                            <td style={{ wordBreak: 'break-all' }} className='small'>{u.txid}:{u.vout}</td>
                            <td>{u.satoshis}</td>
                          </tr>
                        ))}
                      </tbody>
                    </Table>
                  )}

                  <h6>Shares</h6>
                  <Table size='sm' bordered responsive>
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Name</th>
                        <th>UTXOs</th>
                        <th>Total sats</th>
                      </tr>
                    </thead>
                    <tbody>
                      {status.shares.map((s) => (
                        <tr key={s.index}>
                          <td>{s.index}</td>
                          <td>{s.name}</td>
                          <td>{s.utxoCount}</td>
                          <td>{s.totalSatoshis}</td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>

                  <div className='d-flex flex-wrap gap-2 mt-3'>
                    {status.needsConsolidate && (
                      <Button as={Link} to='/consolidate' variant='primary'>
                        Consolidate
                      </Button>
                    )}
                    {status.canSplit && (
                      <Button as={Link} to='/split' variant='success'>
                        Split
                      </Button>
                    )}
                    <Button as={Link} to='/claim/cosign' variant='outline-secondary'>
                      Claim cosign
                    </Button>
                    <Button as={Link} to='/claim' variant='outline-secondary'>
                      Claim broadcast
                    </Button>
                  </div>
                </>
              )}
            </Card.Body>
          </Card>
        </Col>
      </Row>
    </Container>
  )
}

export default PoolStatus
export { NeedConfig }
