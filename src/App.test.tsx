import { render, screen } from '@testing-library/react'
import App from './App'

describe('App', () => {
  it('renders the social diagram search', () => {
    render(<App />)
    expect(screen.getByRole('textbox', { name: /search diagrams/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /\+ new/i })).toBeInTheDocument()
  })
})
