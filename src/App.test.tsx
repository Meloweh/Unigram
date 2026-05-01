import { render, screen } from '@testing-library/react'
import App from './App'

describe('App', () => {
  it('renders the Omnigram toolbar', () => {
    render(<App />)
    expect(screen.getByRole('button', { name: /spawn 2000/i })).toBeInTheDocument()
  })
})
