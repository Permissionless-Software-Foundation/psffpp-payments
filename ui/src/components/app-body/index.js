/*
  This Body component is a container for all the different Views of the app.
*/

// Global npm libraries
import React from 'react'
import { Route, Routes } from 'react-router-dom'

// Local libraries
import Wallet from './bch-wallet'
import BchSend from './bch-send'
import SignMessage from './sign/index.js'
import ServerSelectView from './configuration/select-server-view'
import ContractsConfig from './contracts'
import PoolStatus from './pool'
import ConsolidateView from './consolidate'
import SplitView from './split'
import ClaimCosignView from './claim-cosign'
import ClaimBroadcastView from './claim'

function AppBody (props) {
  const appData = props.appData

  return (
    <>
      <Routes>
        <Route path='/' element={<BchSend appData={appData} />} />
        <Route path='/bch' element={<BchSend appData={appData} />} />
        <Route path='/wallet' element={<Wallet appData={appData} />} />
        <Route path='/sign' element={<SignMessage appData={appData} />} />
        <Route path='/configuration' element={<ServerSelectView appData={appData} />} />
        <Route path='/servers' element={<ServerSelectView appData={appData} />} />
        <Route path='/contracts' element={<ContractsConfig appData={appData} />} />
        <Route path='/pool' element={<PoolStatus appData={appData} />} />
        <Route path='/consolidate' element={<ConsolidateView appData={appData} />} />
        <Route path='/split' element={<SplitView appData={appData} />} />
        <Route path='/claim/cosign' element={<ClaimCosignView appData={appData} />} />
        <Route path='/claim' element={<ClaimBroadcastView appData={appData} />} />
      </Routes>
    </>
  )
}

export default AppBody
