/*
  Navigation menu for PSFFPP Payments UI.
*/

import React, { useState } from 'react'
import { Nav, Navbar, Image } from 'react-bootstrap'
import { NavLink } from 'react-router-dom'
import Logo from './psf-logo.png'

function linkClass (currentPath, paths) {
  const list = Array.isArray(paths) ? paths : [paths]
  return list.includes(currentPath) ? 'nav-link-active' : 'nav-link-inactive'
}

function NavMenu (props) {
  const { currentPath } = props.appData
  const [expanded, setExpanded] = useState(false)

  const handleClickEvent = () => {
    setExpanded(false)
  }

  return (
    <>
      <Navbar expanded={expanded} onToggle={setExpanded} expand='xxxl' bg='dark' variant='dark' style={{ paddingRight: '20px' }}>
        <Navbar.Brand href='#home' style={{ paddingLeft: '20px' }}>
          <Image src={Logo} thumbnail width='50' />{' '}
          PSFFPP Payments
        </Navbar.Brand>

        <Navbar.Toggle aria-controls='responsive-navbar-nav' />
        <Navbar.Collapse id='responsive-navbar-nav'>
          <Nav className='mr-auto'>
            <NavLink
              className={linkClass(currentPath, ['/bch', '/'])}
              to='/bch'
              onClick={handleClickEvent}
            >
              BCH
            </NavLink>

            <NavLink
              className={linkClass(currentPath, '/wallet')}
              to='/wallet'
              onClick={handleClickEvent}
            >
              Wallet
            </NavLink>

            <NavLink
              className={linkClass(currentPath, '/sign')}
              to='/sign'
              onClick={handleClickEvent}
            >
              Sign
            </NavLink>

            <NavLink
              className={linkClass(currentPath, '/contracts')}
              to='/contracts'
              onClick={handleClickEvent}
            >
              Contracts
            </NavLink>

            <NavLink
              className={linkClass(currentPath, '/pool')}
              to='/pool'
              onClick={handleClickEvent}
            >
              Pool
            </NavLink>

            <NavLink
              className={linkClass(currentPath, '/consolidate')}
              to='/consolidate'
              onClick={handleClickEvent}
            >
              Consolidate
            </NavLink>

            <NavLink
              className={linkClass(currentPath, '/split')}
              to='/split'
              onClick={handleClickEvent}
            >
              Split
            </NavLink>

            <NavLink
              className={linkClass(currentPath, '/claim/cosign')}
              to='/claim/cosign'
              onClick={handleClickEvent}
            >
              Cosign
            </NavLink>

            <NavLink
              className={linkClass(currentPath, '/claim')}
              to='/claim'
              onClick={handleClickEvent}
            >
              Claim
            </NavLink>

            <NavLink
              className={linkClass(currentPath, '/configuration')}
              to='/configuration'
              onClick={handleClickEvent}
            >
              Configuration
            </NavLink>
          </Nav>
        </Navbar.Collapse>
      </Navbar>
    </>
  )
}

export default NavMenu
