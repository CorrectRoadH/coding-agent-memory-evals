import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom'
import { TooltipController as Tooltip } from '../components/TooltipController'

// Tell Jest to mock all timeout functions
jest.useRealTimers()

const PLACE_CLASS_PREFIX = 'react-tooltip__place-'

/**
 * These assertions only look at the tooltip's rendered DOM, which is what a consumer
 * writing placement-specific CSS actually targets. `middlewares` is a public prop
 * (floating-ui middleware array), so a placement that differs from the requested
 * `place` can be produced through the public API without reaching into how the
 * component computes or stores it internally.
 */
const forcePlacement = (placement) => ({
  name: 'force-placement',
  fn(state) {
    if (state.placement === placement) {
      return {}
    }
    return { reset: { placement } }
  },
})

const Anchored = ({ id, ...tooltipProps }) => (
  <>
    <span id={id} data-tooltip-content="Hello World!">
      Lorem Ipsum
    </span>
    <Tooltip anchorId={id} {...tooltipProps} />
  </>
)

const placeClassesOf = (element) =>
  Array.from(element.classList).filter((name) => name.startsWith(PLACE_CLASS_PREFIX))

async function showTooltip() {
  await userEvent.hover(screen.getByText('Lorem Ipsum'))
  await waitFor(() => {
    expect(screen.getByRole('tooltip')).toBeInTheDocument()
  })
  return screen.getByRole('tooltip')
}

describe('tooltip placement class', () => {
  test('exposes the placement on the tooltip root element', async () => {
    render(<Anchored id="place-default" />)

    const tooltip = await showTooltip()

    await waitFor(() => {
      expect(placeClassesOf(screen.getByRole('tooltip'))).toEqual([`${PLACE_CLASS_PREFIX}top`])
    })
    expect(tooltip).toHaveClass('react-tooltip')
  })

  test.each(['top', 'bottom', 'left', 'right'])(
    'exposes the placement when positioning agrees with place="%s"',
    async (place) => {
      render(<Anchored id={`place-${place}`} place={place} middlewares={[forcePlacement(place)]} />)

      await showTooltip()

      await waitFor(() => {
        expect(placeClassesOf(screen.getByRole('tooltip'))).toEqual([
          `${PLACE_CLASS_PREFIX}${place}`,
        ])
      })
    },
  )

  test('exposes the placement the tooltip actually resolved to, not the requested one', async () => {
    render(<Anchored id="place-flipped" place="top" middlewares={[forcePlacement('right')]} />)

    await showTooltip()

    await waitFor(() => {
      expect(screen.getByRole('tooltip')).toHaveClass(`${PLACE_CLASS_PREFIX}right`)
    })
    expect(screen.getByRole('tooltip')).not.toHaveClass(`${PLACE_CLASS_PREFIX}top`)
  })

  test('carries exactly one placement class once the position has been resolved', async () => {
    render(<Anchored id="place-single" place="bottom" middlewares={[forcePlacement('left')]} />)

    await showTooltip()

    await waitFor(() => {
      expect(placeClassesOf(screen.getByRole('tooltip'))).toEqual([`${PLACE_CLASS_PREFIX}left`])
    })
  })

  test('is already present when the tooltip first appears, before any flip is resolved', async () => {
    render(<Anchored id="place-no-flash" place="left" middlewares={[forcePlacement('bottom')]} />)

    // read the class synchronously on the very first appearance of the tooltip
    const tooltip = await showTooltip()
    expect(placeClassesOf(tooltip)).toHaveLength(1)

    await waitFor(() => {
      expect(placeClassesOf(screen.getByRole('tooltip'))).toEqual([`${PLACE_CLASS_PREFIX}bottom`])
    })
  })

  test('stays in sync when the tooltip is repositioned', async () => {
    const { rerender } = render(<Anchored id="place-sync" place="top" />)

    await showTooltip()
    await waitFor(() => {
      expect(placeClassesOf(screen.getByRole('tooltip'))).toEqual([`${PLACE_CLASS_PREFIX}top`])
    })

    rerender(<Anchored id="place-sync" place="right" />)

    await waitFor(() => {
      expect(placeClassesOf(screen.getByRole('tooltip'))).toEqual([`${PLACE_CLASS_PREFIX}right`])
    })
  })
})
